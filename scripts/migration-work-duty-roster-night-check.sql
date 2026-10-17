-- ============================================================
-- 근무표 구분에 '야간점검' 추가 (22:00~익일 06:00, 잔업 8H, 다음날 퇴근)
-- ============================================================

ALTER TABLE work_duty_roster DROP CONSTRAINT IF EXISTS work_duty_roster_type_chk;
ALTER TABLE work_duty_roster ADD CONSTRAINT work_duty_roster_type_chk
  CHECK (duty_type IN ('평일당직', '휴일당직', '고장대기', '휴일고장대기', '야간점검'));

-- 검증
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'work_duty_roster_type_chk';
