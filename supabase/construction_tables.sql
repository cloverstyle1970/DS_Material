-- 공사요청 테이블
CREATE TABLE IF NOT EXISTS construction_requests (
  id            SERIAL PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT '요청'
                  CHECK (status IN ('요청', '접수', '일정등록됨', '완료')),
  site_name     TEXT NOT NULL DEFAULT '',
  elevator_name TEXT NOT NULL DEFAULT '',
  manager       TEXT NOT NULL DEFAULT '',
  manager_phone TEXT NOT NULL DEFAULT '',
  requester_name TEXT NOT NULL DEFAULT '',
  details       TEXT NOT NULL DEFAULT '',
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 공사일정 테이블
CREATE TABLE IF NOT EXISTS construction_schedules (
  id            SERIAL PRIMARY KEY,
  request_id    INTEGER REFERENCES construction_requests(id) ON DELETE SET NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  start_time    TEXT NOT NULL DEFAULT '',
  site_name     TEXT NOT NULL DEFAULT '',
  elevator_name TEXT NOT NULL DEFAULT '',
  details       TEXT NOT NULL DEFAULT '',
  workers       TEXT NOT NULL DEFAULT '',
  manager       TEXT NOT NULL DEFAULT '',
  manager_phone TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS 비활성화 (내부 시스템)
ALTER TABLE construction_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE construction_schedules  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_construction_requests"  ON construction_requests  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_construction_schedules" ON construction_schedules FOR ALL USING (true) WITH CHECK (true);
