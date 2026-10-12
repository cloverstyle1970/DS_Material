-- migration-prevent-permissions-escalation.sql
-- accounts.permissions 컬럼을 admin 이외의 인증 사용자가 직접 변경하지 못하도록 BEFORE UPDATE 트리거 추가
-- 적용: node scripts/apply-migration.mjs scripts/migration-prevent-permissions-escalation.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_permissions_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_id    BIGINT;
  v_caller_perms JSONB;
BEGIN
  -- service_role 호출 (auth.uid() = NULL) → 관리 작업이므로 허용
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- permissions 컬럼이 실제로 변경되는 경우만 검사
  IF OLD.permissions IS NOT DISTINCT FROM NEW.permissions THEN
    RETURN NEW;
  END IF;

  -- 호출자 accounts.id 추출 (이메일 = "${id}@daesol.el" 규약)
  BEGIN
    v_caller_id := split_part(auth.email(), '@', 1)::BIGINT;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'permissions 변경 권한 없음: 신원 확인 불가';
  END;

  SELECT permissions INTO v_caller_perms FROM accounts WHERE id = v_caller_id;

  IF NOT (v_caller_perms @> '["admin"]'::jsonb OR v_caller_perms ? 'admin') THEN
    RAISE EXCEPTION 'permissions 변경은 admin만 가능합니다';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_permissions_escalation ON accounts;
CREATE TRIGGER check_permissions_escalation
  BEFORE UPDATE OF permissions ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_permissions_escalation();

COMMIT;

-- 검증
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_schema = 'public' AND event_object_table = 'accounts'
  AND trigger_name = 'check_permissions_escalation';
