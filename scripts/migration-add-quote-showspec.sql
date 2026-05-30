-- ============================================================
-- 견적서 규격(spec) 표기 여부
-- ------------------------------------------------------------
-- quotes.show_spec : 출력물에 자재 규격 표시 여부 (기본 TRUE)
-- idempotent.
-- ============================================================
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS show_spec BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'quotes' AND column_name = 'show_spec';
