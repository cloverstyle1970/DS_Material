-- ============================================================
-- 사원등록 페이지 탭 개편용 마이그레이션
-- ------------------------------------------------------------
-- 1) users 테이블: gender, blood_type 컬럼 추가
-- 2) user_certifications: self_check, acquired_date, expiry_date, issuer 컬럼 추가
-- 3) user_family_members: is_emergency, phone 컬럼 추가 (긴급연락처 지정)
-- 4) user_career_history 신규 테이블 (경력)
-- 5) user_rewards_punishments 신규 테이블 (상벌사항)
-- ============================================================

-- 1) users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gender      TEXT CHECK (gender IS NULL OR gender IN ('M','F')),
  ADD COLUMN IF NOT EXISTS blood_type  TEXT CHECK (blood_type IS NULL OR blood_type IN ('A+','A-','B+','B-','O+','O-','AB+','AB-','A','B','O','AB'));

-- 2) user_certifications
ALTER TABLE user_certifications
  ADD COLUMN IF NOT EXISTS self_check     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS acquired_date  DATE,
  ADD COLUMN IF NOT EXISTS expiry_date    DATE,
  ADD COLUMN IF NOT EXISTS issuer         TEXT;

-- 3) user_family_members — 긴급연락처 지정 + 연락처
ALTER TABLE user_family_members
  ADD COLUMN IF NOT EXISTS is_emergency  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phone         TEXT;

-- 사원당 긴급연락처는 1명만 (부분 unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_family_emergency
  ON user_family_members(user_id)
  WHERE is_emergency = TRUE;

-- 4) 경력
CREATE TABLE IF NOT EXISTS user_career_history (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name  TEXT NOT NULL,
  joined_date   DATE,
  left_date     DATE,
  dept          TEXT,
  rank          TEXT,
  duty          TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_career_user_id ON user_career_history(user_id);
ALTER TABLE user_career_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_user_career_history" ON user_career_history;
CREATE POLICY "allow_all_user_career_history" ON user_career_history FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 5) 상벌사항
CREATE TABLE IF NOT EXISTS user_rewards_punishments (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('상','벌')),
  content      TEXT NOT NULL,
  occurred_on  DATE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_rp_user_id ON user_rewards_punishments(user_id);
ALTER TABLE user_rewards_punishments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_user_rewards_punishments" ON user_rewards_punishments;
CREATE POLICY "allow_all_user_rewards_punishments" ON user_rewards_punishments FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 검증
-- ============================================================
SELECT 'users gender/blood_type' AS chk, column_name FROM information_schema.columns
  WHERE table_name='users' AND column_name IN ('gender','blood_type');

SELECT 'user_certifications new cols' AS chk, column_name FROM information_schema.columns
  WHERE table_name='user_certifications' AND column_name IN ('self_check','acquired_date','expiry_date','issuer');

SELECT 'user_family_members new cols' AS chk, column_name FROM information_schema.columns
  WHERE table_name='user_family_members' AND column_name IN ('is_emergency','phone');

SELECT 'user_career_history' AS chk, COUNT(*) FROM user_career_history;
SELECT 'user_rewards_punishments' AS chk, COUNT(*) FROM user_rewards_punishments;
