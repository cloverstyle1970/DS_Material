-- migration-rls-tighten-auth-supplement.sql
-- migration-rls-tighten-auth.sql 에서 누락된 테이블 일괄 보완
-- 2026-10-12: sales_invoices·legacy_quotes 등 20개 테이블 추가
--
-- 적용:  node scripts/apply-migration.mjs scripts/migration-rls-tighten-auth-supplement.sql

BEGIN;

DO $$
DECLARE
  target TEXT;
  pol_name TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'sales_invoices',
    'legacy_quotes',
    'improvement_requests',
    'hazard_surveys',
    'hazard_survey_items',
    'hazard_survey_participants',
    'risk_categories',
    'risk_hazard_items',
    'work_journals',
    'work_journal_items',
    'work_journal_participants',
    'work_journal_env_readings',
    'work_journal_heat_rests',
    'tbm_env_readings',
    'tbm_heat_rests',
    'doc_seq',
    'labor_rates',
    'menu_visits',
    'public_holidays',
    'purchase_order_lines',
    'system_settings'
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

    RAISE NOTICE 'secured: %', target;
  END LOOP;
END
$$;

COMMIT;

-- 검증: 적용된 테이블 정책 확인
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'sales_invoices', 'legacy_quotes', 'improvement_requests',
    'hazard_surveys', 'work_journals', 'risk_categories'
  )
ORDER BY tablename;
