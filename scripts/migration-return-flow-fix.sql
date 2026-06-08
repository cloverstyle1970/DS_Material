-- ============================================================
-- migration-return-flow-fix.sql
-- ============================================================
-- 회수 자재 흐름 보강 (2건)
--
-- A. 단기: add_transaction 의 자유입력 신규 unit 처리에서 ④a 정책 적용
--    회수 자재(requires_return=true) 출고 시 자유입력으로 새로 생성되는 unit 도
--    '반납대기' 상태로 INSERT 한다. 기존엔 무조건 '출고'로 들어가 시리얼이력
--    '반납대기' 필터에 누락되던 문제 해소.
--
-- B. 본질: mark_return_completed RPC 가 material_units 도 갱신
--    transactions.return_status 를 'returned' 로 바꾸는 시점에 연결된
--    material_unit 의 status 도 '반납완료' 로 마킹한다. 재고/stock_qty 는
--    건드리지 않는다 (검수 후 별도 재투입 흐름과의 정합성).

-- ── A. add_transaction RPC 재정의 ─────────────────────────────
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
  v_tracked_stock  integer;
  v_untracked_pool integer;
  v_new_unit_count integer;
  v_new_unit_status text;  -- 자유입력 신규 unit 초기 status (회수 여부 반영)
BEGIN
  SELECT stock_qty, CASE WHEN p_type = '입고' THEN buy_price ELSE sell_price END INTO v_prev_stock, v_unit_price
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_unit_price    := COALESCE(v_unit_price, 0);
  v_serial_count  := COALESCE(array_length(p_serial_nos, 1), 0);
  v_return_status := CASE WHEN p_requires_return AND p_type = '출고' THEN 'pending' ELSE NULL END;
  -- 정책 ④a: 회수 자재라면 자유입력 신규 unit 도 '반납대기' 로 시작
  v_new_unit_status := CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END;

  IF p_type NOT IN ('입고', '출고') THEN
    RETURN json_build_object('error', 'unsupported transaction type: ' || p_type);
  END IF;

  IF v_serial_count > p_qty THEN
    RETURN json_build_object('error', 'S/N 갯수(' || v_serial_count || ')가 수량(' || p_qty || ')보다 많습니다.');
  END IF;

  IF p_type = '출고' AND v_prev_stock < p_qty THEN
    RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
  END IF;

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

    IF v_new_unit_count > v_untracked_pool THEN
      RETURN json_build_object(
        'error',
        '비추적 재고 부족 — 자유입력 S/N ' || v_new_unit_count ||
        '건이 비추적 잔량(' || v_untracked_pool || ')을 초과합니다.'
      );
    END IF;
  END IF;

  v_running_stock := v_prev_stock;

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
        SELECT id, status INTO v_unit_id, v_unit_status
          FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial
         FOR UPDATE;

        IF v_unit_id IS NOT NULL THEN
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
          -- 정책 ④a 반영: 회수 자재면 '반납대기', 아니면 '출고'
          BEGIN
            INSERT INTO material_units (
              material_id, serial_no, status,
              current_site, current_elevator,
              inbound_at, last_event_at
            ) VALUES (
              p_material_id, v_serial, v_new_unit_status,
              p_site_name, p_elevator_name,
              now(), now()
            ) RETURNING id INTO v_unit_id;
          EXCEPTION WHEN unique_violation THEN
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


-- ── B. mark_return_completed RPC 재정의 (material_units 동기 갱신) ──
CREATE OR REPLACE FUNCTION mark_return_completed(
  p_transaction_id integer,
  p_user_id        integer,
  p_user_name      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_record record;
BEGIN
  UPDATE transactions
     SET return_status         = 'returned',
         returned_at           = now(),
         returned_by_user_id   = p_user_id,
         returned_by_user_name = p_user_name
   WHERE id              = p_transaction_id
     AND requires_return = true
     AND return_status   = 'pending'
   RETURNING * INTO v_record;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('error', '대상 트랜잭션을 찾을 수 없거나 이미 반납 처리됨');
  END IF;

  -- 연결된 material_unit 상태를 '반납완료' 로 마킹 (재고 미복원: 검수 후 별도 입고)
  IF v_record.material_unit_id IS NOT NULL THEN
    UPDATE material_units
       SET status        = '반납완료',
           last_event_at = now()
     WHERE id     = v_record.material_unit_id
       AND status IN ('반납대기', '출고');  -- 이미 다른 상태면 보존
  END IF;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;


-- 검증
SELECT proname, pg_get_function_identity_arguments(oid) AS args
  FROM pg_proc
 WHERE proname IN ('add_transaction', 'mark_return_completed')
 ORDER BY proname;
