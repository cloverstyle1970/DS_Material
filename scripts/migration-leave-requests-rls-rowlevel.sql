-- migration-leave-requests-rls-rowlevel.sql
-- leave_requests: 전체 허용 → 작성자/승인자/admin 행 수준 제한
-- 2026-10-12
--
-- auth.email() = "${accounts.id}@daesol.el" 규약으로 accounts.id 매핑
-- 보조 함수 2개(auth_account_id, auth_is_admin)는 다른 테이블에도 재사용 가능

BEGIN;

-- 보조 함수: 현재 로그인 사용자의 accounts.id
CREATE OR REPLACE FUNCTION public.auth_account_id()
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT split_part(auth.email(), '@', 1)::BIGINT;
$$;

-- 보조 함수: 현재 로그인 사용자가 admin인지 여부
CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM accounts
    WHERE id = split_part(auth.email(), '@', 1)::BIGINT
      AND permissions @> '["admin"]'::jsonb
  );
$$;

-- 기존 전체 허용 정책 제거
DROP POLICY IF EXISTS leave_requests_authenticated_all ON leave_requests;

-- SELECT: 인증된 사용자 전체 (원장·승인 화면에서 전체 목록 조회 필요)
CREATE POLICY leave_requests_select ON leave_requests
  FOR SELECT TO authenticated USING (TRUE);

-- INSERT: 본인을 작성자로만 등록 가능
CREATE POLICY leave_requests_insert ON leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth_account_id());

-- UPDATE: 작성자 또는 승인자 또는 admin
CREATE POLICY leave_requests_update ON leave_requests
  FOR UPDATE TO authenticated
  USING (
    author_id   = auth_account_id()
    OR approver_id = auth_account_id()
    OR auth_is_admin()
  )
  WITH CHECK (
    author_id   = auth_account_id()
    OR approver_id = auth_account_id()
    OR auth_is_admin()
  );

-- DELETE: 작성자 또는 admin
CREATE POLICY leave_requests_delete ON leave_requests
  FOR DELETE TO authenticated
  USING (
    author_id = auth_account_id()
    OR auth_is_admin()
  );

COMMIT;

-- 검증
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'leave_requests'
ORDER BY cmd;
