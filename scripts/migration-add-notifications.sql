-- 인앱 알림(notifications) 테이블
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)
--
-- mock-router.ts 의 /api/notifications (GET/POST/PATCH read, read-all) 가 사용.
-- 전역 수신 토글은 users.notifications_enabled (migration-add-notifications-enabled.sql),
-- 푸시 구독은 push_subscriptions (migration-add-push-subscriptions.sql) 로 분리됨.

-- 1) notifications 테이블
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT         NOT NULL DEFAULT 'info',
  title       TEXT         NOT NULL DEFAULT '',
  message     TEXT         NOT NULL DEFAULT '',
  link        TEXT,
  ref_type    TEXT,
  ref_id      BIGINT,
  is_read     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 조회 패턴: user_id 필터 + created_at 내림차순 (목록), is_read 갱신 (읽음 처리)
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id) WHERE NOT is_read;

-- 2) RLS (개발 표준 — 운영 전 강화 필요)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_notifications ON notifications;
CREATE POLICY allow_all_notifications ON notifications
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT
  (SELECT COUNT(*) FROM notifications)                       AS total_notifications,
  (SELECT COUNT(*) FROM notifications WHERE NOT is_read)     AS unread_notifications;
