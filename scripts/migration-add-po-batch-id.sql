-- purchase_orders.batch_id: 같은 발주서로 함께 등록된 PO 묶음 식별
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)
-- 같은 batch_id를 가진 행들은 발주서 수정 시 한꺼번에 로드되어 통합 편집됨.
-- 기존 데이터(NULL)는 단건 편집으로 폴백.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS purchase_orders_batch_id_idx
  ON purchase_orders (batch_id);

-- 검증
SELECT
  COUNT(*) AS total_rows,
  COUNT(batch_id) AS rows_with_batch
FROM purchase_orders;
