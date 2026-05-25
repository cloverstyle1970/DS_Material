-- ============================================================
-- 사원 발령 및 재직상태 이력 관리용 테이블 추가
-- ------------------------------------------------------------
-- users 테이블의 재직 상태(재직, 퇴직, 휴직) 변경 이력을 기록하고
-- 재입사, 복직 등의 세부 이력을 사원별로 타임라인 관리하기 위함
-- ============================================================

CREATE TABLE IF NOT EXISTS user_status_history (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status_type   TEXT NOT NULL CHECK (status_type IN ('입사', '퇴직', '휴직', '복직', '재입사')),
  event_date    DATE NOT NULL,
  reason        TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 인덱스 추가 (사원별/일자순 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_user_status_history_user_id ON user_status_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_status_history_event_date ON user_status_history(event_date);

-- RLS 활성화 및 정책 추가
ALTER TABLE user_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_user_status_history" ON user_status_history;
CREATE POLICY "allow_all_user_status_history" 
  ON user_status_history FOR ALL 
  USING (TRUE) 
  WITH CHECK (TRUE);

-- 검증 쿼리
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'user_status_history';
