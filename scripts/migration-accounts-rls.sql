-- accounts RLS 개방 (신DB 로그인 전환)
-- ------------------------------------------------------------
-- 앱은 API 서버 없이 anon 클라이언트로 직접 호출한다. 다른 테이블과 동일하게
-- accounts 도 개발 표준 USING(TRUE) 정책으로 풀어 anon 이 로그인/프로필 조회를
-- 할 수 있게 한다. (운영 전: password 해시화 + RLS 강화 필요)
-- Supabase Dashboard > SQL Editor 에서 1회 실행 (idempotent)

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- authenticated 전용 정책 제거 후 전체 허용 정책으로 교체
DROP POLICY IF EXISTS auth_full ON accounts;
DROP POLICY IF EXISTS allow_all_accounts ON accounts;
CREATE POLICY allow_all_accounts ON accounts
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT
  relrowsecurity AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='accounts') AS policies
FROM pg_class WHERE relname='accounts';
