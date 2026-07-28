-- ============================================================
-- work_journal_heat_rests: 근무구간 삭제, 휴게시간 시작/종료 시각 컬럼으로 교체
-- ------------------------------------------------------------
-- 데이터 0건이라 안전. TEXT rest_period 대신 TIME rest_start / rest_end.
-- ============================================================

ALTER TABLE work_journal_heat_rests DROP COLUMN IF EXISTS work_period;
ALTER TABLE work_journal_heat_rests DROP COLUMN IF EXISTS rest_period;

ALTER TABLE work_journal_heat_rests ADD COLUMN IF NOT EXISTS rest_start TIME;
ALTER TABLE work_journal_heat_rests ADD COLUMN IF NOT EXISTS rest_end   TIME;

-- 검증
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'work_journal_heat_rests'
ORDER BY ordinal_position;
