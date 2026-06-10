SET client_encoding = 'UTF8';
-- ============================================================
-- 급여명세표: 엑셀 명세서 순번(slip_no) 컬럼 추가
-- ------------------------------------------------------------
-- 엑셀의 각 명세서 블록은 A열 "no." 행의 B열에 순번을 가진다.
-- 기존에는 등록 시 성명순 정렬 후 i+1로 번호를 매겼으나,
-- 엑셀 원본의 순번을 보존해 인쇄 양식에 그대로 표시한다.
-- ============================================================

ALTER TABLE payslips
  ADD COLUMN IF NOT EXISTS slip_no TEXT;

-- 검증
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'payslips' AND column_name = 'slip_no';
