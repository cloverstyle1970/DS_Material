-- ============================================================
-- 근태현황 (관리/인사 > 근태현황)
-- 사원·일자별 근태 수기 등록. 연차계(leave_requests) 승인 건은 화면에서
-- 조회 시 합성하므로 이 테이블에 복사하지 않는다 (승인 취소·수정 시 자동 반영).
-- 직급 전무 이상은 화면에서 제외 (DB 제약 없음).
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_records (
  id          bigserial    PRIMARY KEY,
  account_id  bigint       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  work_date   date         NOT NULL,
  status      text         NOT NULL,
  note        text,
  created_by  bigint       REFERENCES accounts(id) ON DELETE SET NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT attendance_records_account_date_uniq UNIQUE (account_id, work_date)
);

CREATE INDEX IF NOT EXISTS attendance_records_work_date_idx ON attendance_records (work_date);

-- RLS (보안 강화 이후 표준: authenticated 전용)
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_records_authenticated_all ON attendance_records;
CREATE POLICY attendance_records_authenticated_all ON attendance_records
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'attendance_records' ORDER BY ordinal_position;
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'attendance_records';
