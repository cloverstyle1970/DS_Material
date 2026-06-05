-- 신DB RLS 강화 + Supabase Auth 로그인 보조 RPC 신설
--
-- 적용 전제:
--   - 자재관리 코드가 이미 Supabase Auth(signInWithPassword) 로 전환됐을 것.
--   - 모든 accounts 행이 auth.users 에 백필돼 있을 것 (이메일 키 ${accounts.id}@daesol.el).
--     누락된 사원이 있으면 이 마이그레이션 적용 후 로그인 불가 — 먼저
--     scripts/backfill-auth-users.mjs 로 0건 상태 확인할 것.
--
-- 변경 내용:
--   1) public.lookup_account_id_by_username(p_username) RPC 신설
--      - anon 에서 호출 가능 (로그인 전 username → accounts.id 매핑용)
--      - SECURITY DEFINER 로 RLS 우회. id 만 반환 (권한/부서 등은 노출 안 함)
--   2) NEWDB_TABLES 전부의 RLS 정책을 "anon 차단, authenticated 전권" 으로 강화
--      - 기존 allow_all_* 류 정책 일괄 DROP
--      - 새 정책 <table>_authenticated_all: FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE)
--      - 익명 키로 외부에서 데이터 직접 조회/변조 불가
--      - 인증된 사용자(JWT)는 전권 — 페이지/메뉴별 세밀한 권한은 클라이언트 가드 유지
--   3) (선택) storage.objects 등 외부 정책은 손대지 않음.
--
-- 적용 절차:
--   1. Supabase Dashboard → SQL Editor 에서 본 파일 전체 실행.
--   2. 끝의 검증 쿼리 결과로 정책 단일화 확인.
--   3. 자재관리·유지보수 양쪽 로그인 동작 확인.
--   4. 문제 발생 시 ROLLBACK 대신 같은 파일을 재실행하면 정책이 다시 단일화돼 복구 가능
--      (DO 블록이 모든 기존 정책을 DROP 후 새로 생성).

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1) 로그인 보조 RPC
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lookup_account_id_by_username(p_username TEXT)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.accounts WHERE username = p_username LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_account_id_by_username(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_account_id_by_username(TEXT) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2) 모든 업무 테이블 RLS 정책 단일화 — anon 차단, authenticated 전권
-- ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  target TEXT;
  pol_name TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    -- 사원·권한
    'accounts', 'permission_groups', 'departments', 'ranks', 'crews',
    'user_family_members', 'user_career_history', 'user_certifications',
    'user_rewards_punishments', 'user_vehicles', 'user_status_history',
    'vehicle_user_history', 'vehicle_insurance_history',
    -- 현장
    'managed_sites', 'site_elevators', 'vendors',
    -- 자재·재고
    'materials', 'material_units', 'material_requests', 'categories',
    'transactions', 'purchase_orders',
    -- 견적·정산
    'quotes', 'quote_items', 'quote_labor_lines', 'quote_revisions',
    'quote_revision_notes', 'quote_settings', 'quote_requests',
    'quote_request_items', 'labor_categories', 'labor_workload_standards',
    'invoices', 'payments',
    -- TBM
    'tbm_records', 'tbm_participants', 'tbm_participant_checklist',
    'tbm_participant_photos', 'tbm_participant_safety',
    'tbm_checklist_items', 'tbm_checklist_results', 'tbm_photos',
    'tbm_record_safety_rules', 'tbm_safety_rules_master',
    'tbm_fault_types', 'tbm_repair_types',
    -- 기타 업무
    'notifications', 'manuals', 'annual_events',
    'construction_schedules', 'construction_requests',
    'uniform_safety_requests', 'uniform_safety_request_items',
    'push_subscriptions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = target
    ) THEN
      RAISE NOTICE 'skip: % (table missing)', target;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);

    FOR pol_name IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, target);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE)',
      target || '_authenticated_all', target
    );
  END LOOP;
END
$$;

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- 검증 — 적용 직후 한 번에 실행해 결과 확인
-- ─────────────────────────────────────────────────────────────

-- (a) RPC 존재·시그니처
SELECT n.nspname, p.proname, pg_get_function_arguments(p.oid) AS args, p.prosecdef AS is_security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'lookup_account_id_by_username';

-- (b) 정책 단일화 — 각 테이블에 *_authenticated_all 1개만 보여야 정상
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'accounts','managed_sites','site_elevators','materials','transactions',
    'quotes','tbm_records','notifications'
  )
ORDER BY tablename, policyname;

-- (c) 정책 없는 테이블 점검 — DO 블록에서 skip 된 테이블이 없는지
SELECT t.table_name
FROM information_schema.tables t
LEFT JOIN pg_policies p ON p.schemaname='public' AND p.tablename=t.table_name
WHERE t.table_schema='public'
  AND t.table_type='BASE TABLE'
  AND p.policyname IS NULL
ORDER BY t.table_name;
