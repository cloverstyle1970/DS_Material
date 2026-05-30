-- ============================================================
-- 신DB 적용 — 견적↔자재신청/출고/하자 연계 컬럼
-- ------------------------------------------------------------
-- quote-workflow 마이그레이션 중 연계 컬럼 부분만 발췌(신DB 미적용분).
--   · material_requests.quote_id / request_type : 견적-신청 연결 + 청구 유형
--   · transactions.pending_quote                : 당직 선출고(사후 견적 대상)
--   · materials.warranty_months                 : 자재별 하자기간(NULL=기본 36개월)
-- idempotent.
-- ============================================================
ALTER TABLE material_requests
  ADD COLUMN IF NOT EXISTS quote_id      INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_type  TEXT;

ALTER TABLE material_requests DROP CONSTRAINT IF EXISTS material_requests_request_type_check;
ALTER TABLE material_requests
  ADD CONSTRAINT material_requests_request_type_check
  CHECK (request_type IS NULL OR request_type IN ('유상견적','무상신청','당직선출고'));

CREATE INDEX IF NOT EXISTS idx_material_requests_quote_id     ON material_requests(quote_id);
CREATE INDEX IF NOT EXISTS idx_material_requests_request_type ON material_requests(request_type);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS pending_quote BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_transactions_pending_quote
  ON transactions(pending_quote) WHERE pending_quote = TRUE;

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS warranty_months INTEGER;
UPDATE materials
   SET warranty_months = 12
 WHERE warranty_months IS NULL AND right(id, 1) = 'R';

NOTIFY pgrst, 'reload schema';

SELECT 'material_requests.quote_id' AS chk,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='material_requests' AND column_name='quote_id') AS ok
UNION ALL SELECT 'material_requests.request_type',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='material_requests' AND column_name='request_type')
UNION ALL SELECT 'transactions.pending_quote',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='pending_quote')
UNION ALL SELECT 'materials.warranty_months',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='materials' AND column_name='warranty_months');
