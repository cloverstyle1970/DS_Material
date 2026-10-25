-- 재직상태 이력에 '육아휴직' 추가 (근태현황 "육휴" 표시)
-- accounts.status 는 육아휴직도 '휴직' 으로 기록 (종류 구분은 user_status_history.status_type)

ALTER TABLE user_status_history DROP CONSTRAINT IF EXISTS user_status_history_status_type_check;
ALTER TABLE user_status_history ADD CONSTRAINT user_status_history_status_type_check
  CHECK (status_type IN ('입사','퇴직','휴직','육아휴직','복직','재입사','부서이동','진급','강등','전보','직책변경','겸직'));

-- 검증
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'user_status_history'::regclass AND contype = 'c';
