SET client_encoding = 'UTF8';
-- ============================================================
-- 급여명세표 양식 보강
--   - birth_yymmdd: 명세서 표기용 생년월일 (701212 형태 6자리 텍스트)
--   - calc_info JSONB: 임금계산 기초사항 (지급일·통상시급·기본시간·당직·결근 등)
--   - company_name: 양식 상단에 표시되는 사업장명 (㈜대솔이엘 등)
-- ============================================================

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS birth_yymmdd TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS calc_info JSONB;

-- 검증
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'payslips' AND column_name IN ('birth_yymmdd', 'company_name', 'calc_info');
