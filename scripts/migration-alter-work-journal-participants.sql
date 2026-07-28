-- ============================================================
-- work_journal_participants 재편 + work_journals 서명 URL 컬럼 정리
-- ------------------------------------------------------------
-- 1) rank_title 삭제 (자격/직급 UI 제거)
-- 2) signature_url 컬럼 추가 → 참가자별 서명 저장 (worker3 이상도 확장 가능)
-- 3) role CHECK 완화: 'manager' 또는 'worker<숫자>' 허용
-- 4) work_journals의 worker1/worker2/manager_signature_url 컬럼 삭제
--    (서명은 이제 participants 테이블에 통합)
-- 데이터 0건이라 안전.
-- ============================================================

-- (1) 자격/직급 컬럼 삭제
ALTER TABLE work_journal_participants DROP COLUMN IF EXISTS rank_title;

-- (2) 서명 URL 컬럼 추가
ALTER TABLE work_journal_participants ADD COLUMN IF NOT EXISTS signature_url TEXT;

-- (3) role CHECK 완화
ALTER TABLE work_journal_participants DROP CONSTRAINT IF EXISTS work_journal_participants_role_check;
ALTER TABLE work_journal_participants
  ADD CONSTRAINT work_journal_participants_role_check
  CHECK (role = 'manager' OR role ~ '^worker[0-9]+$');

-- (4) 본체에서 서명 URL 3종 삭제
ALTER TABLE work_journals DROP COLUMN IF EXISTS worker1_signature_url;
ALTER TABLE work_journals DROP COLUMN IF EXISTS worker2_signature_url;
ALTER TABLE work_journals DROP COLUMN IF EXISTS manager_signature_url;

-- 검증
SELECT 'participants' AS tbl, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'work_journal_participants'
UNION ALL
SELECT 'journals' AS tbl, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'work_journals' AND column_name LIKE '%signature%'
ORDER BY 1, 2;
