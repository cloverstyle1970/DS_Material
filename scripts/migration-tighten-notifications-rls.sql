-- ============================================================
-- notifications / push_subscriptions RLS 강화 (개발 → 운영)
-- ------------------------------------------------------------
-- 현재 두 테이블 모두 `allow_all` (USING TRUE / WITH CHECK TRUE) 상태로,
-- anon/authenticated 어느 쪽이든 모든 사용자의 알림·구독을 조회·변경 가능.
-- 운영 전 본인 행만 접근하도록 좁힘.
--
-- 적용처: 신DB (Supabase 프로젝트 bbnmxwpacdfqvicybhau)
-- 적용 방법: Dashboard → SQL Editor 에 통째 붙여넣고 Run (idempotent).
--
-- 전제 — 인증 모델:
--   · 사용자 로그인은 signInWithPassword 기반
--   · session.user.email 규약: `${accounts.id}@daesol.el`
--   · auth.jwt() 의 email claim 에서 id 를 추출해 비교
--
-- 참고: men.daesol.kr 와 push_subscriptions 테이블을 공유하므로,
-- 동일 정책이 양 사이트 모두에 적용된다. 두 사이트 모두 같은 email 규약 사용 가정.
-- ============================================================

-- ── 헬퍼 함수: auth.email() → accounts.id (BIGINT) 추출 ─────
-- 형식 `<digits>@daesol.el` 의 앞부분을 숫자로 변환.
-- 매칭 실패 시 NULL 반환 → 정책상 부정.
CREATE OR REPLACE FUNCTION public.auth_account_id()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT NULLIF(SPLIT_PART(COALESCE(auth.jwt()->>'email', ''), '@', 1), '')::BIGINT;
$$;

GRANT EXECUTE ON FUNCTION public.auth_account_id() TO anon, authenticated;

-- ============================================================
-- [1] notifications — user_id = 본인 만 접근 (서비스 역할은 자동 통과)
-- ============================================================
DROP POLICY IF EXISTS allow_all_notifications        ON notifications;
DROP POLICY IF EXISTS notifications_owner_select     ON notifications;
DROP POLICY IF EXISTS notifications_owner_update     ON notifications;
DROP POLICY IF EXISTS notifications_owner_delete     ON notifications;
DROP POLICY IF EXISTS notifications_service_insert   ON notifications;

-- 본인 알림만 조회
CREATE POLICY notifications_owner_select ON notifications
  FOR SELECT
  USING (user_id = public.auth_account_id());

-- 본인 알림만 읽음 처리/수정
CREATE POLICY notifications_owner_update ON notifications
  FOR UPDATE
  USING      (user_id = public.auth_account_id())
  WITH CHECK (user_id = public.auth_account_id());

-- 본인 알림만 삭제 (옵션 — 본인 알림 정리)
CREATE POLICY notifications_owner_delete ON notifications
  FOR DELETE
  USING (user_id = public.auth_account_id());

-- INSERT 는 서버측(Edge Function service_role) + 클라이언트 insertNotification()
-- 둘 다 허용 필요. service_role 은 RLS 우회되므로 정책 불필요.
-- 클라이언트 insertNotification() 은 "타인에게도 알림 INSERT" 하므로
-- WITH CHECK 를 user_id 본인 한정으로 막으면 안 됨 → 인증된 사용자 전반 허용.
CREATE POLICY notifications_authenticated_insert ON notifications
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- [2] push_subscriptions — account_id = 본인 만 접근
--   account_id 가 TEXT 컬럼임에 유의 (신DB 스키마)
-- ============================================================
DROP POLICY IF EXISTS allow_all_push_subscriptions       ON push_subscriptions;
DROP POLICY IF EXISTS push_subs_owner_select             ON push_subscriptions;
DROP POLICY IF EXISTS push_subs_owner_modify             ON push_subscriptions;
DROP POLICY IF EXISTS push_subs_service_send             ON push_subscriptions;

-- 본인 구독만 조회 (push-send Edge Function 은 service_role 이라 우회)
CREATE POLICY push_subs_owner_select ON push_subscriptions
  FOR SELECT
  USING (account_id = public.auth_account_id()::TEXT);

-- 본인 구독만 INSERT/UPDATE/DELETE
-- (push-subscribe Edge Function 은 service_role 이라 우회. 클라이언트 직접 호출 보호용)
CREATE POLICY push_subs_owner_insert ON push_subscriptions
  FOR INSERT
  WITH CHECK (account_id = public.auth_account_id()::TEXT);

CREATE POLICY push_subs_owner_update ON push_subscriptions
  FOR UPDATE
  USING      (account_id = public.auth_account_id()::TEXT)
  WITH CHECK (account_id = public.auth_account_id()::TEXT);

CREATE POLICY push_subs_owner_delete ON push_subscriptions
  FOR DELETE
  USING (account_id = public.auth_account_id()::TEXT);

-- ============================================================
-- 검증
-- ============================================================
-- 정책 목록
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('notifications', 'push_subscriptions')
ORDER BY tablename, policyname;

-- 헬퍼 함수가 정상 동작하는지 (anon 컨텍스트에선 NULL 이 정상)
SELECT public.auth_account_id() AS jwt_account_id;
