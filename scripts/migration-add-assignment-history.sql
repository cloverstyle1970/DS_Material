-- ============================================================
-- 인사이동(발령) 이력 추가 — user_status_history 확장
-- ------------------------------------------------------------
-- 기존 user_status_history(고용상태 변동: 입사/퇴직/휴직/복직/재입사)에
-- 부서이동·진급 등 '발령' 이력을 함께 담기 위해 확장한다.
--   1) from/to 부서·직급 컬럼 추가 (발령 전/후 값 기록)
--   2) status_type 허용값에 발령 구분 추가
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)
-- ============================================================

-- 1) 발령 전/후 부서·직급 컬럼
ALTER TABLE user_status_history
  ADD COLUMN IF NOT EXISTS from_dept  TEXT,
  ADD COLUMN IF NOT EXISTS to_dept    TEXT,
  ADD COLUMN IF NOT EXISTS from_rank  TEXT,
  ADD COLUMN IF NOT EXISTS to_rank    TEXT;

-- 2) status_type 허용값 확장
--    기존 인라인 CHECK는 자동명 'user_status_history_status_type_check'.
--    제약을 교체해 발령 구분(부서이동/진급/강등/전보/직책변경/겸직)을 허용한다.
ALTER TABLE user_status_history
  DROP CONSTRAINT IF EXISTS user_status_history_status_type_check;

ALTER TABLE user_status_history
  ADD CONSTRAINT user_status_history_status_type_check
  CHECK (status_type IN (
    '입사', '퇴직', '휴직', '복직', '재입사',
    '부서이동', '진급', '강등', '전보', '직책변경', '겸직'
  ));

-- ============================================================
-- 검증
-- ============================================================
-- 신규 컬럼 확인
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_status_history'
  AND column_name IN ('from_dept', 'to_dept', 'from_rank', 'to_rank')
ORDER BY column_name;

-- CHECK 제약 정의 확인
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'user_status_history'::regclass
  AND conname = 'user_status_history_status_type_check';
