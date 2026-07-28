-- ============================================================
-- work_journal_heat_rests 에서 실시·온도·습도·체감온도 컬럼 삭제
-- ------------------------------------------------------------
-- 온열질환 예방 휴게 표를 순수 휴게 시간만 기록하도록 축소.
-- 데이터 0건이라 안전.
-- ============================================================

ALTER TABLE work_journal_heat_rests DROP COLUMN IF EXISTS executed;
ALTER TABLE work_journal_heat_rests DROP COLUMN IF EXISTS temperature;
ALTER TABLE work_journal_heat_rests DROP COLUMN IF EXISTS humidity;
ALTER TABLE work_journal_heat_rests DROP COLUMN IF EXISTS apparent_temperature;

-- 검증
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'work_journal_heat_rests'
ORDER BY ordinal_position;
