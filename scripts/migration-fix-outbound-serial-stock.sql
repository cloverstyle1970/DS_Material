-- ============================================================
-- migration-fix-outbound-serial-stock.sql
-- ============================================================
-- 버그 수정: 재고가 시리얼 등록 재고만 있을 때 새 S/N으로 출고 시 재고 부족 에러
--
-- 원인:
--   비추적 잔량(v_untracked_pool = stock_qty - tracked_stock)이 0이면
--   새 S/N(신규 자유입력)을 생성할 풀이 없다고 판단해 에러 반환.
--   → 전체 재고(stock_qty)는 충분하지만 모두 S/N 등록 재고여서 untracked_pool=0 인 경우가 블록됨.
--
-- 수정 정책:
--   ① 비추적 풀이 있으면 기존처럼 신규 unit 생성 (변경 없음)
--   ② 비추적 풀이 소진됐지만 전체 재고가 충분하면 → 가장 오래된 '재고' 추적 unit의
--      serial_no를 입력된 새 S/N으로 갱신 + 상태를 '출고'/'반납대기'로 변경
--      (물리 재고는 동일하므로 stock_qty 카운트는 그대로 -1 처리)
--   ③ 신규 S/N 수가 전체 재고 초과 시 에러 (기존 전체 재고 부족 검증으로 커버됨)

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
  v_prev_stock          integer;
  v_running_stock       integer;
  v_local_prev          integer;
  v_unit_id             integer;
  v_unit_status         text;
  v_serial              text;
  v_records             json[] := ARRAY[]::json[];
  v_record              record;
  v_return_status       text;
  v_serial_count        integer;
  v_remaining           integer;
  v_unit_price          integer;
  v_tracked_stock       integer;
  v_untracked_pool      integer;
  v_new_unit_count      integer;
  v_remaining_untracked integer;  -- 루프 내 비추적 풀 잔량 추적
BEGIN
  -- 자재 재고 잠금 및 당시 단가 조회
  SELECT stock_qty, CASE WHEN p_type = '입고' THEN buy_price ELSE sell_price END
    INTO v_prev_stock, v_unit_price
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

  -- 출고 시 전체 재고 사전 검증
  IF p_type = '출고' AND v_prev_stock < p_qty THEN
    RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
  END IF;

  -- 출고 + S/N 입력 시: 비추적 풀과 추적 재고 계산
  v_remaining_untracked := 0;
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
     WHERE mu.id IS NULL;

    -- [수정] 신규 S/N이 전체 재고를 초과하면 거부 (비추적 풀 한정 검사 제거)
    -- 비추적 풀이 부족해도 추적 재고(stock_qty)가 충분하면 루프에서 기존 unit 갱신으로 처리
    IF v_new_unit_count > v_prev_stock THEN
      RETURN json_build_object(
        'error',
        '재고 부족 — 자유입력 S/N ' || v_new_unit_count ||
        '건이 전체 재고(' || v_prev_stock || ')를 초과합니다.'
      );
    END IF;

    v_remaining_untracked := GREATEST(0, v_untracked_pool);
  END IF;

  v_running_stock := v_prev_stock;

  -- ── (1) S/N 추적분: 1건당 unit + 트랜잭션 ────────────────────
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
        -- 동일 자재에 동일 S/N unit이 있는지 조회 (상태 무관)
        SELECT id, status INTO v_unit_id, v_unit_status
          FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial
         FOR UPDATE;

        IF v_unit_id IS NOT NULL THEN
          -- 기존 unit 존재
          IF v_unit_status = '재고' THEN
            UPDATE material_units
               SET status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
                   current_site     = p_site_name,
                   current_elevator = p_elevator_name,
                   last_event_at    = now()
             WHERE id = v_unit_id;
          ELSE
            RETURN json_build_object(
              'error', 'S/N ' || v_serial || ' 은(는) 이미 ''' || v_unit_status || ''' 상태입니다. 다른 S/N을 사용하세요.'
            );
          END IF;

        ELSE
          -- 신규 S/N — 비추적 풀에서 소비하거나 기존 추적 unit 갱신
          IF v_remaining_untracked > 0 THEN
            -- 비추적 풀 잔량이 있으면 신규 unit 생성
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
              RETURN json_build_object('error', '동시성 충돌 — S/N ' || v_serial || ' 가 방금 등록되었습니다. 다시 시도하세요.');
            END;
            v_remaining_untracked := v_remaining_untracked - 1;

          ELSE
            -- [수정] 비추적 풀 소진 → 가장 오래된 '재고' 추적 unit의 S/N을 새 S/N으로 갱신
            -- (물리 재고는 동일: S/N 불일치 해소 + 출고 처리)
            SELECT id INTO v_unit_id
              FROM material_units
             WHERE material_id = p_material_id AND status = '재고'
             ORDER BY inbound_at ASC
             LIMIT 1
             FOR UPDATE;

            IF v_unit_id IS NULL THEN
              RETURN json_build_object('error', '재고 부족 — 사용 가능한 재고 unit이 없습니다.');
            END IF;

            UPDATE material_units
               SET serial_no        = v_serial,
                   status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
                   current_site     = p_site_name,
                   current_elevator = p_elevator_name,
                   last_event_at    = now()
             WHERE id = v_unit_id;
          END IF;
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
