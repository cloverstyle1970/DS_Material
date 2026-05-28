-- 현장 화면 전환: managed_sites / site_elevators RLS 개방
-- ------------------------------------------------------------
-- 앱은 anon 클라이언트로 직접 호출하므로, 다른 테이블과 동일하게
-- 개발 표준 USING(TRUE) 정책으로 푼다. (운영 전 RLS 강화 필요)
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)

ALTER TABLE managed_sites  ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_elevators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_full ON managed_sites;
DROP POLICY IF EXISTS allow_all_managed_sites ON managed_sites;
CREATE POLICY allow_all_managed_sites ON managed_sites
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS auth_full ON site_elevators;
DROP POLICY IF EXISTS allow_all_site_elevators ON site_elevators;
CREATE POLICY allow_all_site_elevators ON site_elevators
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT tablename, policyname, roles::text
FROM pg_policies WHERE schemaname='public' AND tablename IN ('managed_sites','site_elevators');
