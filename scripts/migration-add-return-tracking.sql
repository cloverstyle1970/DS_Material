-- 출고 시 회수 자재 추적 + 자재담당자 반납 등록 기능 지원
-- 1) transactions 테이블에 회수 관련 컬럼 추가
-- 2) add_transaction RPC가 신규 컬럼들을 받도록 시그니처 확장

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS elevator_name           text,
  ADD COLUMN IF NOT EXISTS serial_no               text,
  ADD COLUMN IF NOT EXISTS requires_return         boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS return_status           text,
  ADD COLUMN IF NOT EXISTS returned_at             timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by_user_id     integer,
  ADD COLUMN IF NOT EXISTS returned_by_user_name   text;

CREATE INDEX IF NOT EXISTS idx_transactions_return_status
  ON transactions(return_status)
  WHERE requires_return = true;

-- 기존 함수 삭제 후 재작성 (시그니처 변경)
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text);
DROP FUNCTION IF EXISTS add_transaction(text, text, text, integer, text, text, integer, text, text, text, boolean);

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
  p_serial_no       text DEFAULT NULL,
  p_requires_return boolean DEFAULT false
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev_stock  integer;
  v_after_stock integer;
  v_delta       integer;
  v_record      record;
BEGIN
  v_delta := CASE WHEN p_type = '입고' THEN p_qty ELSE -p_qty END;

  SELECT stock_qty INTO v_prev_stock
  FROM materials WHERE id = p_material_id FOR UPDATE;

  IF v_prev_stock IS NULL THEN
    RETURN json_build_object('error', '자재를 찾을 수 없습니다.');
  END IF;

  v_after_stock := v_prev_stock + v_delta;
  IF v_after_stock < 0 THEN
    RETURN json_build_object('error', '재고 부족 (현재 재고: ' || v_prev_stock || ')');
  END IF;

  UPDATE materials SET stock_qty = v_after_stock WHERE id = p_material_id;

  INSERT INTO transactions (
    type, material_id, material_name, qty, prev_stock, after_stock,
    site_name, note, user_id, user_name,
    elevator_name, serial_no, requires_return, return_status
  ) VALUES (
    p_type, p_material_id, p_material_name, p_qty, v_prev_stock, v_after_stock,
    p_site_name, p_note, p_user_id, p_user_name,
    p_elevator_name, p_serial_no, p_requires_return,
    CASE
      WHEN p_requires_return AND p_type = '출고' THEN 'pending'
      ELSE NULL
    END
  ) RETURNING * INTO v_record;

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- 반납 등록용 RPC: 자재담당자가 회수 자재 수령 후 호출
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

  RETURN json_build_object('record', row_to_json(v_record));
END;
$$;

-- 확인
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN ('elevator_name', 'serial_no', 'requires_return', 'return_status', 'returned_at', 'returned_by_user_id', 'returned_by_user_name')
ORDER BY column_name;
