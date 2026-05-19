-- 1. transactions 테이블에 batch_id 추가
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS batch_id uuid;

-- 2. 기존 add_transaction 함수 제거 및 batch_id 추가하여 재생성
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text[], boolean);
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
        material_unit_id, batch_id
      ) VALUES (
        p_type, p_material_id, p_material_name, 1, v_local_prev, v_running_stock,
        p_site_name, p_note, p_user_id, p_user_name,
        p_elevator_name, v_serial, p_requires_return, v_return_status,
        v_unit_id, p_batch_id
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
      material_unit_id, batch_id
    ) VALUES (
      p_type, p_material_id, p_material_name, v_remaining, v_local_prev, v_running_stock,
      p_site_name, p_note, p_user_id, p_user_name,
      p_elevator_name, NULL, p_requires_return, v_return_status,
      NULL, p_batch_id
    ) RETURNING * INTO v_record;

    v_records := array_append(v_records, row_to_json(v_record)::json);
  END IF;

  UPDATE materials SET stock_qty = v_running_stock WHERE id = p_material_id;
  RETURN json_build_object('records', array_to_json(v_records));
END;
$$;

-- 3. 특정 batch_id에 속한 모든 트랜잭션 롤백 및 삭제 함수 생성
CREATE OR REPLACE FUNCTION delete_transaction_batch(
  p_batch_id uuid
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  tx record;
  v_running_stock integer;
BEGIN
  -- 안전 장치: batch_id가 없는 경우 롤백 불가
  IF p_batch_id IS NULL THEN
    RETURN json_build_object('error', 'batch_id가 필요합니다.');
  END IF;

  -- batch_id에 해당하는 트랜잭션들을 최근 생성된 것부터 역순으로 처리
  FOR tx IN SELECT * FROM transactions WHERE batch_id = p_batch_id ORDER BY id DESC LOOP
    -- 현재 재고 가져오기
    SELECT stock_qty INTO v_running_stock FROM materials WHERE id = tx.material_id FOR UPDATE;

    IF tx.type = '입고' THEN
      -- 입고 취소: 재고 감소
      v_running_stock := v_running_stock - tx.qty;
      -- 시리얼 추적 장비였다면 material_units에서 해당 S/N 데이터 삭제
      IF tx.material_unit_id IS NOT NULL THEN
        DELETE FROM material_units WHERE id = tx.material_unit_id;
      END IF;
    ELSE
      -- 출고 취소: 재고 증가
      v_running_stock := v_running_stock + tx.qty;
      -- 시리얼 추적 장비였다면 material_units를 원래 '재고' 상태로 복원
      IF tx.material_unit_id IS NOT NULL THEN
        UPDATE material_units 
           SET status = '재고', current_site = NULL, current_elevator = NULL, last_event_at = now()
         WHERE id = tx.material_unit_id;
      END IF;
    END IF;

    -- 재고량 업데이트
    UPDATE materials SET stock_qty = v_running_stock WHERE id = tx.material_id;
    -- 트랜잭션 삭제
    DELETE FROM transactions WHERE id = tx.id;
  END LOOP;

  RETURN json_build_object('ok', true);
END;
$$;
