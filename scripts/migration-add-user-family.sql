-- ============================================================
-- 사원 가족정보 테이블
-- ------------------------------------------------------------
-- 사원등록·수정 시 입력하는 가족 정보 (1:N)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_family_members (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship  TEXT NOT NULL,            -- 배우자/장남/장녀/부/모 등
  name          TEXT NOT NULL,
  birth_date    DATE,
  occupation    TEXT,
  cohabiting    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_family_user_id ON user_family_members(user_id);

ALTER TABLE user_family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_user_family_members" ON user_family_members;
CREATE POLICY "allow_all_user_family_members" ON user_family_members FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT 'user_family_members' AS tbl, COUNT(*) FROM user_family_members;
