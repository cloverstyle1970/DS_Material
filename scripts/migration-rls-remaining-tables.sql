-- migration-rls-remaining-tables.sql
-- 유지보수 팀 확인: incentive_records, sites, purchase_orders_migration_map RLS 미적용 보완
-- 2026-10-12

BEGIN;

DO $$
DECLARE
  target TEXT;
  pol_name TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'incentive_records',
    'sites',
    'purchase_orders_migration_map'
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

SELECT tablename, policyname, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('incentive_records', 'sites', 'purchase_orders_migration_map')
ORDER BY tablename;
