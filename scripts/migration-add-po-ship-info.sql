SET client_encoding = 'UTF8';
-- purchase_orders 발송지/납품 기록란 (발주서 인쇄용)
-- 발주서 하단 기록란(발송지·납기 희망일·인수자·연락처·담당자·특기사항)을
-- 발주 데이터에 저장. 같은 batch_id 행에 동일 값이 중복 저장되며,
-- 발주서 수정 시 첫 행(head)에서 로드된다.
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS ship_to        TEXT,
  ADD COLUMN IF NOT EXISTS ship_due_date  TEXT,
  ADD COLUMN IF NOT EXISTS ship_receiver  TEXT,
  ADD COLUMN IF NOT EXISTS ship_contact   TEXT,
  ADD COLUMN IF NOT EXISTS ship_manager   TEXT,
  ADD COLUMN IF NOT EXISTS ship_note      TEXT;

-- 검증
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'purchase_orders'
  AND column_name IN ('ship_to','ship_due_date','ship_receiver','ship_contact','ship_manager','ship_note')
ORDER BY column_name;
