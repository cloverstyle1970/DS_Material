-- S/N 부분 추적 지원: serial_nos 배열 길이가 수량보다 적어도 허용.
-- 입력된 S/N 수만큼 unit + 트랜잭션 생성, 잔여 수량은 단일 비추적 트랜잭션.
-- 예: 입고 qty=10에 S/N 3건 입력 → 3개 unit(tracked) + 1개 비추적(qty=7) = 총 4 트랜잭션, 재고 +10
--
-- 변경: serial_count > qty 면 에러, 그 외엔 모두 허용.

DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean);

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
  p_requires_return boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_stock     integer;
  v_running_stock  integer;
  v_local_prev     integer;
  v_unit_id        integer;
  v_serial         text;
  v_records        json[] := ARRAY[]::json[];
  v_record         record;
  v_return_status  text;
  v_serial_count   integer;
  v_remaining      integer;
BEGIN
  SELECT stock_qty INTO v_prev_stock
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

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
        SELECT id INTO v_unit_id FROM material_units
         WHERE material_id = p_material_id AND serial_no = v_serial AND status = '재고'
         FOR UPDATE;

        IF v_unit_id IS NULL THEN
          RETURN json_build_object('error', 'S/N ' || v_serial || ' 가(이) 재고 상태 unit이 아닙니다.');
        END IF;

        UPDATE material_units
           SET status           = CASE WHEN p_requires_return THEN '반납대기' ELSE '출고' END,
               current_site     = p_site_name,
               current_elevator = p_elevator_name,
               last_event_at    = now()
         WHERE id = v_unit_id;

        v_running_stock := v_running_stock - 1;
      END IF;

      INSERT INTO transactions (
        type, material_id, material_name, qty, prev_stock, after_stock,
        site_name, note, user_id, user_name,
        elevator_name, serial_no, requires_return, return_status,
        material_unit_id
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id
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
      material_unit_id
    ) VALUES (
      p_type, p_material_id, p_material_name, v_remaining, v_local_prev, v_running_stock,
      p_site_name, p_note, p_user_id, p_user_name,
      p_elevator_name, NULL, p_requires_return, v_return_status,
      NULL
    ) RETURNING * INTO v_record;

    v_records := array_append(v_records, row_to_json(v_record)::json);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
  RETURN json_build_object('records', array_to_json(v_records));
END;
$$;
