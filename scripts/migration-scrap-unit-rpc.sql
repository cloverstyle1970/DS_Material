-- 자재실사 S/N 폐기 처리용 RPC
-- 재고 상태인 unit을 '폐기'로 마킹 + 출고 트랜잭션 기록 + 자재 stock_qty -1
-- 재고가 아닌 unit은 거부 (출고/반납대기/반납완료/폐기 unit은 실사 폐기 불가)

CREATE OR REPLACE FUNCTION scrap_material_unit(
  p_unit_id   integer,
  p_user_id   integer,
  p_user_name text,
  p_note      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_unit         material_units%ROWTYPE;
  v_prev_stock   integer;
  v_after_stock  integer;
  v_material_name text;
  v_record       record;
BEGIN
  SELECT * INTO v_unit FROM material_units WHERE id = p_unit_id FOR UPDATE;
  IF v_unit.id IS NULL THEN
    RETURN json_build_object('error', 'unit을 찾을 수 없습니다.');
  END IF;

  IF v_unit.status <> '재고' THEN
    RETURN json_build_object('error', '재고 상태가 아닌 unit은 실사 폐기 불가 (현재: ' || v_unit.status || ')');
  END IF;

  -- 자재 재고 -1
  SELECT stock_qty, name INTO v_prev_stock, v_material_name
  FROM materials WHERE id = v_unit.material_id FOR UPDATE;
  v_after_stock := v_prev_stock - 1;
  UPDATE materials SET stock_qty = v_after_stock WHERE id = v_unit.material_id;

  -- unit 상태 → 폐기
  UPDATE material_units
     SET status        = '폐기',
         last_event_at = now()
   WHERE id = p_unit_id;

  -- 출고 트랜잭션 기록
  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status,
    material_unit_id
  ) VALUES (
    '출고', v_unit.material_id, v_material_name, 1, v_prev_stock, v_after_stock,
    NULL, COALESCE(p_note, '재고실사 손실'), p_user_id, p_user_name,
    NULL, v_unit.serial_no, false, NULL,
    v_unit.id
  ) RETURNING * INTO v_record;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;
