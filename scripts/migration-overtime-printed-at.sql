-- ============================================================
-- 잔업보고서 인쇄 일시 컬럼 추가
-- ============================================================

ALTER TABLE overtime_reports
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

-- 확인
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'overtime_reports' AND column_name = 'printed_at';
