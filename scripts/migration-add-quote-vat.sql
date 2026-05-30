-- ============================================================
-- 견적서 부가세 표시 모드
-- ------------------------------------------------------------
-- quotes.vat_included : 부가세 포함 여부 (FALSE=별도 기본, TRUE=포함)
--   출력 양식에서 공급가액/부가세(10%)/합계 3행을 표시하고,
--   별도면 공급가액을, 포함이면 합계를 대표 금액으로 강조.
-- idempotent.
-- ============================================================
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS vat_included BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'quotes' AND column_name = 'vat_included';
