-- ============================================================
-- work_journal_participants.role CHECK 제약 재조정
-- ------------------------------------------------------------
-- 관리주체 확인자 기능 제거에 따라 'manager' 값 허용을 삭제.
-- role 은 이제 'worker<숫자>' 형식만 허용.
-- 데이터 0건이라 안전.
-- ============================================================

ALTER TABLE work_journal_participants DROP CONSTRAINT IF EXISTS work_journal_participants_role_check;
ALTER TABLE work_journal_participants
  ADD CONSTRAINT work_journal_participants_role_check
  CHECK (role ~ '^worker[0-9]+$');

-- 검증
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'work_journal_participants'::regclass
  AND contype = 'c';
