-- users 테이블에 password_hash 컬럼 추가
-- SHA-256("1234") = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

-- 실행 확인
SELECT id, name, LEFT(password_hash, 8) || '...' AS pw_preview
FROM users
LIMIT 5;
