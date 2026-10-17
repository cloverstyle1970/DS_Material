-- ============================================================
-- 월 근무표 (관리/인사 > 주52시간 관리 > 근무표 등록)
-- 당직·고장대기 배정. 주52시간 계산 시 이 테이블에 등록된 달은 이 근무표를,
-- 등록되지 않은 달은 유지보수 사이트 근무표(duty_roster)를 사용한다.
-- duty_type 별 잔업시간: 평일당직 9.5H / 휴일당직 17.5H / 고장대기 4H / 휴일고장대기 12H
-- ============================================================

CREATE TABLE IF NOT EXISTS work_duty_roster (
  id          bigserial    PRIMARY KEY,
  duty_date   date         NOT NULL,
  account_id  bigint       NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  duty_type   text         NOT NULL,
  note        text,
  created_by  bigint       REFERENCES accounts(id) ON DELETE SET NULL,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT work_duty_roster_type_chk CHECK (duty_type IN ('평일당직', '휴일당직', '고장대기', '휴일고장대기')),
  CONSTRAINT work_duty_roster_uniq UNIQUE (duty_date, account_id, duty_type)
);

CREATE INDEX IF NOT EXISTS work_duty_roster_date_idx ON work_duty_roster (duty_date);

ALTER TABLE work_duty_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_duty_roster_authenticated_all ON work_duty_roster;
CREATE POLICY work_duty_roster_authenticated_all ON work_duty_roster
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'work_duty_roster' ORDER BY ordinal_position;
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'work_duty_roster';
