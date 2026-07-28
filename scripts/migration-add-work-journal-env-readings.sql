-- ============================================================
-- work_journal_env_readings 테이블 신설
-- ------------------------------------------------------------
-- 상단 환경 지표를 시간대별로 여러 번 저장할 수 있게 로그 테이블 도입.
-- observed_at 은 관측 시각(HH:MM), 온도·습도·체감온도 각 소수 1자리.
-- ============================================================

CREATE TABLE IF NOT EXISTS work_journal_env_readings (
  id                    BIGSERIAL PRIMARY KEY,
  journal_id            BIGINT NOT NULL REFERENCES work_journals(id) ON DELETE CASCADE,
  seq                   INT NOT NULL,
  observed_at           TIME,                                -- 관측 시각
  temperature           NUMERIC(4,1),
  humidity              NUMERIC(4,1),
  apparent_temperature  NUMERIC(4,1),
  location              TEXT,                              -- 지역명 (선택)
  UNIQUE (journal_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_work_journal_env_readings_journal_id
  ON work_journal_env_readings(journal_id);

-- RLS (본 앱 개발 표준)
ALTER TABLE work_journal_env_readings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_work_journal_env_readings" ON work_journal_env_readings;
CREATE POLICY "allow_all_work_journal_env_readings"
  ON work_journal_env_readings FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'work_journal_env_readings'
ORDER BY ordinal_position;
