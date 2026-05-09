-- ============================================================
-- user_family_members에 성별 컬럼 추가
-- ============================================================

ALTER TABLE user_family_members
  ADD COLUMN IF NOT EXISTS gender TEXT
  CHECK (gender IS NULL OR gender IN ('M', 'F'));

-- 검증
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'user_family_members' AND column_name = 'gender';
