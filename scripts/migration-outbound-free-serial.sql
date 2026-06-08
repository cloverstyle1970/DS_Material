-- ============================================================
-- migration-outbound-free-serial.sql
-- ============================================================
-- 출고전표 S/N 자유입력 허용 (자재실사 등으로 들어온 비추적 재고에 S/N 부여)
--
-- 정책 (1단계):
--   ① 동일 자재에 동일 S/N unit이 status='재고' → 기존 unit 사용 (이전 동작 유지)
--   ① 동일 자재에 동일 S/N unit이 status≠'재고' → 에러 (이미 출고/반납대기/폐기됨)
--   ② 동일 S/N이 다른 자재에 등록되어 있으면 허용 — material_units UNIQUE는 이미 (material_id, serial_no) 복합
--   ③ 신규 S/N(비추적 풀에서 가져오는 것)이 비추적 잔량을 초과하면 거부
--   ④ requires_return=true 라도 자유입력으로 생성된 신규 unit은 status='출고'로 (반납대기 X)
--   ⑤ 자유입력 신규 unit의 inbound_at = now() (출고 시각)
--
-- 변경 대상: add_transaction RPC 만.
-- 다른 RPC(mark_unused_return, scrap_material_unit, delete_transaction_batch)는 영향 없음.

DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean, uuid);

CREATE OR REPLACE FUNCTION add_transaction(
  p_type            text,
  p_material_id     text,
  p_material_name   text,
  p_qty             integer,
  p_site_name       text,
  p_note            text,
  p_user_id         integer,
  p_user_name       text,
  p_elevator_name   text DEFAULT NULL,
  p_serial_nos      text[] DEFAULT NULL,
  p_requires_return boolean DEFAULT false,
  p_batch_id        uuid DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_stock     integer;
  v_running_stock  integer;
  v_local_prev     integer;
  v_unit_id        integer;
  v_unit_status    text;
  v_serial         text;
  v_records        json[] := ARRAY[]::json[];
  v_record         record;
  v_return_status  text;
  v_serial_count   integer;
  v_remaining      integer;
  v_unit_price     integer;
  v_tracked_stock  integer;  -- 해당 자재의 '재고' 상태 unit 수 (추적분)
  v_untracked_pool integer;  -- 비추적 잔량 = stock_qty - tracked_stock
  v_new_unit_count integer;  -- 자유입력으로 신규 생성될 unit 수
BEGIN
  -- 자재 재고 잠금 및 당시 단가(입고: buy_price, 출고: sell_price) 동시 조회
  SELECT stock_qty, CASE WHEN p_type = '입고' THEN buy_price ELSE sell_price END INTO v_prev_stock, v_unit_price
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_unit_price    := COALESCE(v_unit_price, 0);
  v_serial_count  := COALESCE(array_length(p_serial_nos, 1), 0);
  v_return_status := CASE WHEN p_requires_return AND p_type = '출고' THEN 'pending' ELSE NULL END;

  IF p_type NOT IN ('입고', '출고') THEN
    RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
  END IF;

  IF v_serial_count > p_qty THEN
    RETURN json_build_object('error', 'S/N 갯수(' || v_serial_count || ')가 수량(' || p_qty || ')보다 많습니다.');
  END IF;

  -- 출고 시 사전 재고 검증 (tracked + untracked 합산)
  IF p_type = '출고' AND v_prev_stock < p_qty THEN
    RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
  END IF;

  -- 출고 + S/N 자유입력 사전 검증: 신규 S/N 수가 비추적 잔량을 초과하면 거부 (정책 ③)
  IF p_type = '출고' AND v_serial_count > 0 THEN
    SELECT COUNT(*) INTO v_tracked_stock
      FROM material_units
     WHERE material_id = p_material_id AND status = '재고';
    v_untracked_pool := v_prev_stock - v_tracked_stock;

    SELECT COUNT(*) INTO v_new_unit_count
      FROM unnest(p_serial_nos) AS s(serial_no)
      LEFT JOIN material_units mu
        ON mu.material_id = p_material_id
       AND mu.serial_no   = s.serial_no
     WHERE mu.id IS NULL;  -- 동일 자재에 없는 S/N = 신규 자유입력 후보

    IF v_new_unit_count > v_untracked_pool THEN
      RETURN json_build_object(
        'error',
        '비추적 재고 부족 — 자유입력 S/N ' || v_new_unit_count ||
        '건이 비추적 잔량(' || v_untracked_pool || ')을 초과합니다.'
      );
    END IF;
  END IF;

  v_running_stock := v_prev_stock;

  -- ── (1) 추적분: S/N 1건당 unit + 트랜잭션 ────────────────────
  IF v_serial_count > 0 THEN
    FOREACH v_serial IN ARRAY p_serial_nos LOOP
      v_local_prev := v_running_stock;

      IF p_type = '입고' THEN
        BEGIN
          INSERT INTO material_units (material_id, serial_no, status, inbound_at, last_event_at)
          VALUES (p_material_id, v_serial, '재고', now(), now())
          RETURNING id INTO v_unit_id;
        EXCEPTION WHEN unique_violation THEN
          RETURN json_build_object('error', '이미 등록된 S/N: ' || v_serial);
        END;
        v_running_stock := v_running_stock + 1;

      ELSE -- 출고
        -- 1) 동일 자재에 동일 S/N unit이 있는지 조회 (상태 무관)
        SELECT id, status INTO v_unit_id, v_unit_status
          FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial
         FOR UPDATE;

        IF v_unit_id IS NOT NULL THEN
          -- 1-a) 재고 상태 unit → 기존 사용 (이전 동작)
          IF v_unit_status = '재고' THEN
            UPDATE material_units
               SET status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
                   current_site     = p_site_name,
                   current_elevator = p_elevator_name,
                   last_event_at    = now()
             WHERE id = v_unit_id;
          ELSE
            -- 1-b) 재고 외 상태 unit → 에러 (정책 ①)
            RETURN json_build_object(
              'error', 'S/N ' || v_serial || ' 은(는) 이미 ''' || v_unit_status || ''' 상태입니다. 다른 S/N을 사용하세요.'
            );
          END IF;
        ELSE
          -- 2) 동일 자재에 unit 없음 → 자유입력 신규 unit 생성 (정책 ④⑤)
          --    inbound_at = now() (출고 시각), status = '출고' 고정 (회수 여부 무관)
          BEGIN
            INSERT INTO material_units (
              material_id, serial_no, status,
              current_site, current_elevator,
              inbound_at, last_event_at
            ) VALUES (
              p_material_id, v_serial, '출고',
              p_site_name, p_elevator_name,
              now(), now()
            ) RETURNING id INTO v_unit_id;
          EXCEPTION WHEN unique_violation THEN
            -- 안전망: 동시성으로 인한 중복 (이론상 위 SELECT FOR UPDATE에서 잡혔어야 함)
            RETURN json_build_object('error', '동시성 충돌 — S/N ' || v_serial || ' 가 방금 등록되었습니다. 다시 시도하세요.');
          END;
        END IF;

        v_running_stock := v_running_stock - 1;
      END IF;

      INSERT INTO transactions (
        type, material_id, material_name, qty, prev_stock, after_stock,
        site_name, note, user_id, user_name,
        elevator_name, serial_no, requires_return, return_status,
        material_unit_id, batch_id, unit_price
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id, p_batch_id, v_unit_price
      ) RETURNING * INTO v_record;

      v_records := array_append(v_records, row_to_json(v_record)::json);
    END LOOP;
  END IF;

  -- ── (2) 잔여 비추적분: 단일 트랜잭션 ────────────────────────
  v_remaining := p_qty - v_serial_count;
  IF v_remaining > 0 THEN
    v_local_prev := v_running_stock;
    IF p_type = '입고' THEN
      v_running_stock := v_running_stock + v_remaining;
    ELSE
      v_running_stock := v_running_stock - v_remaining;
    END IF;

    INSERT INTO transactions (
      type, material_id, material_name, qty, prev_stock, after_stock,
      site_name, note, user_id, user_name,
      elevator_name, serial_no, requires_return, return_status,
      material_unit_id, batch_id, unit_price
    ) VALUES (
      p_type, p_material_id, p_material_name, v_remaining, v_local_prev, v_running_stock,
      p_site_name, p_note, p_user_id, p_user_name,
      p_elevator_name, NULL, p_requires_return, v_return_status,
      NULL, p_batch_id, v_unit_price
    ) RETURNING * INTO v_record;

    v_records := array_append(v_records, row_to_json(v_record)::json);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
  RETURN json_build_object('records', array_to_json(v_records));
END;
$$;

-- 검증 쿼리
SELECT
  proname AS function_name,
  pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname = 'add_transaction';
