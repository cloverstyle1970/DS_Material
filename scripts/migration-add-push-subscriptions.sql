-- Web Push 구독 저장 + 사용자별 Push 수신 토글
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)
--
-- 인앱 알림(notifications_enabled)과 분리해서 푸시만 별도로 끌 수 있도록 함.
-- push_subscriptions: 한 사용자가 여러 기기에서 구독 가능 (PC + 모바일 등).
--   endpoint UNIQUE — 같은 브라우저에서 재구독해도 1행 유지.

-- 1) users.push_enabled (브라우저 푸시 수신 여부, 기본 TRUE)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) push_subscriptions 테이블
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT         NOT NULL UNIQUE,
  p256dh      TEXT         NOT NULL,
  auth        TEXT         NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON push_subscriptions (user_id);

-- 3) RLS (개발 표준 — 운영 전 강화 필요)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_push_subscriptions ON push_subscriptions;
CREATE POLICY allow_all_push_subscriptions ON push_subscriptions
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT
  (SELECT COUNT(*) FROM users WHERE push_enabled) AS users_push_on,
  (SELECT COUNT(*) FROM push_subscriptions)       AS total_subscriptions;
