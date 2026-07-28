-- ============================================================
-- work_journal_items: work_time(TEXT) → work_start·work_end(TIME) 로 교체
-- ------------------------------------------------------------
-- 데이터 0건이라 안전. 작업 시작/종료 시각 두 개로 분리 저장.
-- ============================================================

ALTER TABLE work_journal_items DROP COLUMN IF EXISTS work_time;

ALTER TABLE work_journal_items ADD COLUMN IF NOT EXISTS work_start TIME;
ALTER TABLE work_journal_items ADD COLUMN IF NOT EXISTS work_end   TIME;

-- 검증
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'work_journal_items'
ORDER BY ordinal_position;
