-- ============================================================
-- work_journal_heat_rests 에 rest_method(휴게방법) 컬럼 추가
-- ------------------------------------------------------------
-- 온도/습도/체감온도 열을 삭제한 대신 "휴게방법" 자유 텍스트 열을 도입.
-- 데이터 0건이라 안전.
-- ============================================================

ALTER TABLE work_journal_heat_rests ADD COLUMN IF NOT EXISTS rest_method TEXT;

-- 검증
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'work_journal_heat_rests'
ORDER BY ordinal_position;
