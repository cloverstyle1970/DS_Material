-- ============================================================
-- 근무변경 요청 (주52시간 관리 > 근무표 등록 > 근무변경요청)
-- 요청자 근무(from_roster) ↔ 대상자 근무(to_roster) 맞교환.
-- 흐름: pending_peer(대상자 승인 대기) → pending_admin(시스템관리자 최종 승인 대기) → approved(근무표 반영)
--       어느 단계든 rejected / 요청자 canceled
-- 요청 시 주 64시간 초과 여부를 검토해 check_result 에 보관.
-- ============================================================

CREATE TABLE IF NOT EXISTS duty_change_requests (
  id               bigserial    PRIMARY KEY,
  requester_id     bigint       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_id        bigint       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_roster_id   bigint       REFERENCES work_duty_roster(id) ON DELETE SET NULL,
  to_roster_id     bigint       REFERENCES work_duty_roster(id) ON DELETE SET NULL,
  from_date        date         NOT NULL,
  from_type        text         NOT NULL,
  to_date          date         NOT NULL,
  to_type          text         NOT NULL,
  reason           text,
  status           text         NOT NULL DEFAULT 'pending_peer',
  check_result     jsonb,
  peer_decided_at  timestamptz,
  admin_id         bigint       REFERENCES accounts(id) ON DELETE SET NULL,
  admin_decided_at timestamptz,
  reject_reason    text,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT duty_change_requests_status_chk
    CHECK (status IN ('pending_peer', 'pending_admin', 'approved', 'rejected', 'canceled'))
);

CREATE INDEX IF NOT EXISTS duty_change_requests_requester_idx ON duty_change_requests (requester_id);
CREATE INDEX IF NOT EXISTS duty_change_requests_target_idx ON duty_change_requests (target_id);
CREATE INDEX IF NOT EXISTS duty_change_requests_status_idx ON duty_change_requests (status);

ALTER TABLE duty_change_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS duty_change_requests_authenticated_all ON duty_change_requests;
CREATE POLICY duty_change_requests_authenticated_all ON duty_change_requests
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'duty_change_requests' ORDER BY ordinal_position;
