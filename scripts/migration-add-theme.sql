-- users 테이블에 theme 컬럼 추가
-- 사용자별 화면 테마(라이트/다크) 저장
-- 'light' | 'dark' 두 값만 사용

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'light'
  CHECK (theme IN ('light', 'dark'));

-- 실행 확인
SELECT id, name, theme
FROM users
LIMIT 5;
