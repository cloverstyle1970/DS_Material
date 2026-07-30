-- ============================================================
-- 작업일지(Work Journal) 완전 폐지
-- ------------------------------------------------------------
-- TBM 이 폭염예방/휴게/환경지표를 전부 흡수하면서 이중관리 해소.
-- 자식 테이블은 부모 CASCADE 로 자동 삭제되지만 명시적으로 순서대로 DROP.
-- 관련 Storage 파일(tbm-photos 버킷의 work-journal/ 하위)은 별도 정리 필요.
-- ============================================================

DROP TABLE IF EXISTS public.work_journal_env_readings CASCADE;
DROP TABLE IF EXISTS public.work_journal_heat_rests   CASCADE;
DROP TABLE IF EXISTS public.work_journal_items        CASCADE;
DROP TABLE IF EXISTS public.work_journal_participants CASCADE;
DROP TABLE IF EXISTS public.work_journals             CASCADE;

-- ============================================================
-- 도움말 센터 매뉴얼 항목 제거 (2026-07-28 추가된 작업일지 매뉴얼)
-- ============================================================
DELETE FROM public.manuals WHERE title = '승강기 유지관리 작업일지 사용자 매뉴얼';

-- ============================================================
-- 권한 그룹 permissions[] 에서 /safety/work-journal* 항목 제거
-- ------------------------------------------------------------
-- permission_groups.permissions 는 text[], accounts.permissions 는 jsonb.
-- ============================================================
UPDATE public.permission_groups
SET permissions = (
  SELECT COALESCE(ARRAY_AGG(p), '{}')
  FROM UNNEST(permissions) AS p
  WHERE p NOT LIKE 'menu:/safety/work-journal%'
)
WHERE EXISTS (
  SELECT 1 FROM UNNEST(permissions) AS p WHERE p LIKE 'menu:/safety/work-journal%'
);

UPDATE public.accounts
SET permissions = (
  SELECT COALESCE(JSONB_AGG(p), '[]'::jsonb)
  FROM JSONB_ARRAY_ELEMENTS_TEXT(permissions) AS p
  WHERE p NOT LIKE 'menu:/safety/work-journal%'
)
WHERE JSONB_TYPEOF(permissions) = 'array'
  AND EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS_TEXT(permissions) AS p
    WHERE p LIKE 'menu:/safety/work-journal%'
  );

-- ============================================================
-- 검증
-- ============================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'work_journal%';
-- (기대: 결과 0행)

SELECT COUNT(*) AS remaining_manual_items FROM public.manuals WHERE title = '승강기 유지관리 작업일지 사용자 매뉴얼';
-- (기대: 0)

SELECT id, name, permissions
FROM public.permission_groups
WHERE EXISTS (
  SELECT 1 FROM UNNEST(permissions) AS p WHERE p LIKE 'menu:/safety/work-journal%'
);
-- (기대: 0행)

SELECT id, username FROM public.accounts
WHERE JSONB_TYPEOF(permissions) = 'array'
  AND EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS_TEXT(permissions) AS p
    WHERE p LIKE 'menu:/safety/work-journal%'
  );
-- (기대: 0행)
