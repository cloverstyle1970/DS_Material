-- users.notifications_enabled: 인앱 알림 수신 여부 (전역 on/off)
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 검증
SELECT
  COUNT(*) AS total_users,
  COUNT(*) FILTER (WHERE notifications_enabled) AS enabled_users
FROM users;
