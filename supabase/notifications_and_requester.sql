-- 1. construction_requests 에 requester_user_id 추가 (FK)
-- 2. notifications 테이블 생성 (인앱 알림)
-- Supabase Dashboard > SQL Editor 에서 1회 실행

ALTER TABLE construction_requests
  ADD COLUMN IF NOT EXISTS requester_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS construction_requests_requester_user_id_idx
  ON construction_requests (requester_user_id);

-- notifications: 사용자별 인앱 알림
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'info',     -- 'schedule_registered', 'info' 등
  title       TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL DEFAULT '',
  link        TEXT,                              -- 클릭 시 이동할 내부 경로 (예: /construction/schedule)
  ref_type    TEXT,                              -- 'construction_schedule' 등
  ref_id      INTEGER,                           -- 관련 row id
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx
  ON notifications (user_id, is_read, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_notifications" ON notifications FOR ALL USING (true) WITH CHECK (true);
