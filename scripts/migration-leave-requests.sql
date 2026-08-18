-- ============================================================
-- 년차계(휴가신청서) 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_requests (
  id                bigserial    PRIMARY KEY,
  request_no        text         NOT NULL UNIQUE,
  author_id         bigint       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  leave_type        text         NOT NULL DEFAULT '연차',
  s_yr              text,
  s_mo              text,
  s_dy              text,
  s_hr              text,
  s_mi              text,
  e_yr              text,
  e_mo              text,
  e_dy              text,
  e_hr              text,
  e_mi              text,
  duration_days     numeric,
  reason            text,
  sub_yr            text,
  sub_mo            text,
  sub_dy            text,
  approver_id       bigint       REFERENCES accounts(id) ON DELETE SET NULL,
  approval_status   text         NOT NULL DEFAULT 'draft',
  approver_signature text,
  author_signature  text,
  submitted_at      timestamptz,
  approved_at       timestamptz,
  rejected_at       timestamptz,
  reject_reason     text,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_leave_requests ON leave_requests;
CREATE POLICY allow_all_leave_requests ON leave_requests FOR ALL USING (true) WITH CHECK (true);

-- 문서번호 채번 함수: LR-YY-NNN
CREATE OR REPLACE FUNCTION next_lr_no() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  yy  text := to_char(now(), 'YY');
  seq int;
  no  text;
BEGIN
  SELECT count(*) + 1 INTO seq
    FROM leave_requests
   WHERE request_no LIKE 'LR-' || yy || '-%';
  no := 'LR-' || yy || '-' || lpad(seq::text, 3, '0');
  RETURN no;
END;
$$;

-- 검증
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'leave_requests' ORDER BY ordinal_position;
