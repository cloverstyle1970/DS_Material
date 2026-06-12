-- Web Push 구독 저장 + 사용자별 Push 수신 토글 (신DB 스키마 기준)
-- Supabase Dashboard > SQL Editor 에서 실행 (idempotent — 재실행 안전).
--
-- 신DB 구조 — 확인 완료(2026-06-12):
--   push_subscriptions(id, account_id, endpoint, subscription JSONB, created_at)
--   accounts.push_enabled BOOLEAN DEFAULT TRUE
--   accounts.notifications_enabled BOOLEAN DEFAULT TRUE
--   subscription 컬럼은 PushSubscription JSON({endpoint, keys:{p256dh,auth}})을 그대로 보관.
--   endpoint는 UNIQUE — 같은 브라우저에서 재구독해도 1행 유지.
--   한 계정이 여러 기기(PC + 모바일)에서 동시 구독 가능.

-- 1) accounts에 push/인앱 알림 수신 토글
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS push_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) push_subscriptions 테이블
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           BIGSERIAL    PRIMARY KEY,
  account_id   BIGINT       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint     TEXT         NOT NULL UNIQUE,
  subscription JSONB        NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_account_id_idx
  ON push_subscriptions (account_id);

-- 3) RLS (개발 표준 — 운영 전 강화 필요)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_push_subscriptions ON push_subscriptions;
CREATE POLICY allow_all_push_subscriptions ON push_subscriptions
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT
  (SELECT COUNT(*) FROM accounts WHERE push_enabled)          AS accounts_push_on,
  (SELECT COUNT(*) FROM accounts WHERE notifications_enabled) AS accounts_inapp_on,
  (SELECT COUNT(*) FROM push_subscriptions)                   AS total_subscriptions;
