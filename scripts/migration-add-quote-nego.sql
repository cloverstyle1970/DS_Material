-- ============================================================
-- 견적 Nego 확정가 (VAT 별도)
-- ------------------------------------------------------------
-- quotes.nego_amount : 협상 확정 공급가액 (0 = 미사용).
--   > 0 이면 부가세·합계를 이 금액 기준으로 산출하고,
--   출력물에서 공급가액 바로 위에 빨간색으로 강조 표시.
-- idempotent.
-- ============================================================
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS nego_amount INTEGER NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'quotes' AND column_name = 'nego_amount';
