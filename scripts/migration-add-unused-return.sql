-- ============================================================
-- 미사용 반납 기능 (재입고 처리 자동화)
-- ------------------------------------------------------------
-- · 출고 자재의 반납을 두 가지로 구분:
--   - scrap : 폐자재 회수 (FM/하자보증, requires_return=true)
--             → 반납 완료 처리만 (재고 변동 없음)
--   - unused: 미사용 반납 (requires_return=false)
--             → 반납 완료 + 자동 재입고 (재고 +qty, S/N '재고' 복원)
-- · 미사용 반납은 회수체크 안 된 일반 출고만 대상
-- ============================================================

-- 1) return_type 컬럼 추가
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS return_type text
    CHECK (return_type IS NULL OR return_type IN ('scrap', 'unused'));

-- 2) 기존 반납 완료된 폐자재회수 데이터 정리 (return_type='scrap'으로 마킹)
UPDATE transactions
   SET return_type = 'scrap'
 WHERE requires_return = true
   AND return_status = 'returned'
   AND return_type IS NULL;

-- 3) 기존 mark_return_completed 함수에서 return_type='scrap' 설정하도록 갱신
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
         return_type           = 'scrap',
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

  -- S/N 추적 자재: unit 상태 '반납완료'로
  IF v_record.material_unit_id IS NOT NULL THEN
    UPDATE material_units
       SET status        = '반납완료',
           last_event_at = now()
     WHERE id = v_record.material_unit_id;
  END IF;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- 4) 신규 RPC: mark_unused_return (미사용 반납 + 자동 재입고)
CREATE OR REPLACE FUNCTION mark_unused_return(
  p_transaction_id integer,
  p_user_id        integer,
  p_user_name      text
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx        record;
  v_new_stock integer;
BEGIN
  -- 대상 출고 트랜잭션 잠금
  SELECT * INTO v_tx
    FROM transactions
   WHERE id = p_transaction_id
   FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RETURN json_build_object('error', '대상 트랜잭션을 찾을 수 없습니다.');
  END IF;
  IF v_tx.type <> '출고' THEN
    RETURN json_build_object('error', '출고 트랜잭션만 미사용 반납이 가능합니다.');
  END IF;
  IF v_tx.requires_return = true THEN
    RETURN json_build_object('error', '회수체크된 출고는 미사용 반납이 불가합니다 (폐자재회수 처리).');
  END IF;
  IF v_tx.return_status IS NOT NULL THEN
    RETURN json_build_object('error', '이미 반납 처리된 출고입니다.');
  END IF;

  -- 트랜잭션 상태 갱신
  UPDATE transactions
     SET return_status         = 'returned',
         return_type           = 'unused',
         returned_at           = now(),
         returned_by_user_id   = p_user_id,
         returned_by_user_name = p_user_name
   WHERE id = p_transaction_id;

  -- 재고 복원
  UPDATE materials
     SET stock_qty = stock_qty + v_tx.qty
   WHERE id = v_tx.material_id
   RETURNING stock_qty INTO v_new_stock;

  -- S/N 추적 자재: unit 상태 '재고'로 복원
  IF v_tx.material_unit_id IS NOT NULL THEN
    UPDATE material_units
       SET status           = '재고',
           current_site     = NULL,
           current_elevator = NULL,
           last_event_at    = now()
     WHERE id = v_tx.material_unit_id;
  END IF;

  -- 감사용 입고 트랜잭션 자동 생성 (note에 원출고 ID 표기)
  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status, return_type,
    material_unit_id
  ) VALUES (
    '입고', v_tx.material_id, v_tx.material_name, v_tx.qty,
    v_new_stock - v_tx.qty, v_new_stock,
    v_tx.site_name,
    '[미사용 반납 재입고] 원출고 #' || v_tx.id ||
      CASE WHEN v_tx.serial_no IS NOT NULL THEN ' / S/N ' || v_tx.serial_no ELSE '' END,
    p_user_id, p_user_name,
    v_tx.elevator_name, v_tx.serial_no, false, NULL, NULL,
    v_tx.material_unit_id
  );

  RETURN json_build_object('ok', true, 'restored_stock', v_new_stock);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT 'return_type column' AS check,
       count(*) AS exists
  FROM information_schema.columns
 WHERE table_name = 'transactions' AND column_name = 'return_type'
UNION ALL
SELECT 'mark_unused_return function',
       count(*)
  FROM information_schema.routines
 WHERE routine_name = 'mark_unused_return';
