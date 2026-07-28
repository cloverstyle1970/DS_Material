-- ============================================================
-- work_journals + work_journal_env_readings 에 location(지역) 컬럼 추가
-- ------------------------------------------------------------
-- 상단 대표 지역, 각 기상 로그의 지역명을 별도 저장.
-- 데이터 0건이라 안전. NULL 허용, 기본값 없음.
-- ============================================================

ALTER TABLE work_journals             ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE work_journal_env_readings ADD COLUMN IF NOT EXISTS location TEXT;

-- 검증
SELECT 'journals'     AS tbl, column_name, data_type FROM information_schema.columns
  WHERE table_name = 'work_journals' AND column_name = 'location'
UNION ALL
SELECT 'env_readings' AS tbl, column_name, data_type FROM information_schema.columns
  WHERE table_name = 'work_journal_env_readings' AND column_name = 'location';
