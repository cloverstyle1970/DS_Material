-- ============================================================
-- 회사차량 수정 이력 + 폐차 상태 관리
-- ============================================================

-- 1. user_vehicles에 폐차 상태 컬럼 추가
ALTER TABLE user_vehicles
  ADD COLUMN IF NOT EXISTS status            TEXT    NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','scrapped')),
  ADD COLUMN IF NOT EXISTS scrapped_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scrapped_by_id    INTEGER,
  ADD COLUMN IF NOT EXISTS scrapped_by_name  TEXT,
  ADD COLUMN IF NOT EXISTS scrapped_note     TEXT;

-- 2. 사용자 변경 이력
CREATE TABLE IF NOT EXISTS vehicle_user_history (
  id              SERIAL PRIMARY KEY,
  vehicle_id      INTEGER NOT NULL REFERENCES user_vehicles(id) ON DELETE CASCADE,
  prev_user_id    INTEGER,
  prev_user_name  TEXT,
  new_user_id     INTEGER,
  new_user_name   TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_id   INTEGER,
  changed_by_name TEXT,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_history_vehicle ON vehicle_user_history(vehicle_id);

-- 3. 보험정보 변경 이력
CREATE TABLE IF NOT EXISTS vehicle_insurance_history (
  id              SERIAL PRIMARY KEY,
  vehicle_id      INTEGER NOT NULL REFERENCES user_vehicles(id) ON DELETE CASCADE,
  prev_company    TEXT,
  prev_start_date DATE,
  prev_end_date   DATE,
  prev_age_range  TEXT,
  prev_scope      TEXT,
  prev_doc_url    TEXT,
  new_company     TEXT,
  new_start_date  DATE,
  new_end_date    DATE,
  new_age_range   TEXT,
  new_scope       TEXT,
  new_doc_url     TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_id   INTEGER,
  changed_by_name TEXT,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_vehicle_insurance_history_vehicle ON vehicle_insurance_history(vehicle_id);

-- RLS
ALTER TABLE vehicle_user_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_insurance_history  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_vehicle_user_history"      ON vehicle_user_history;
DROP POLICY IF EXISTS "allow_all_vehicle_insurance_history" ON vehicle_insurance_history;

CREATE POLICY "allow_all_vehicle_user_history"      ON vehicle_user_history      FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_vehicle_insurance_history" ON vehicle_insurance_history FOR ALL USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT 'user_vehicles status' AS check, COUNT(*) AS cnt FROM information_schema.columns
WHERE table_name='user_vehicles' AND column_name IN ('status','scrapped_at','scrapped_by_id','scrapped_by_name','scrapped_note')
UNION ALL SELECT 'vehicle_user_history',      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='vehicle_user_history')
UNION ALL SELECT 'vehicle_insurance_history', (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='vehicle_insurance_history');
