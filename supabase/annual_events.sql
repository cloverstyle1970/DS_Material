-- 연간일정 테이블 (단체연차 · 휴무 · 행사 · 기타)
CREATE TABLE IF NOT EXISTS annual_events (
  id          SERIAL PRIMARY KEY,
  year        INTEGER NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  type        TEXT NOT NULL DEFAULT '기타'
                CHECK (type IN ('연차', '휴무', '행사', '기타')),
  title       TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annual_events_year ON annual_events(year);

ALTER TABLE annual_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_annual_events" ON annual_events FOR ALL USING (true) WITH CHECK (true);
