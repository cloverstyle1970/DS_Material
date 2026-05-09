-- ============================================================
-- users 테이블에 email 컬럼 추가
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT;

-- 검증
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'email';
