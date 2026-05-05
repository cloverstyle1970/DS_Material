-- material_units RLS 재활성화 + 정책 부여 (다른 테이블과 일관성)
--
-- 1) 먼저 기존 transactions 테이블 정책 패턴 확인 (참고용)
-- 2) material_units에 동일한 형태의 개방형(또는 anon 허용) 정책 추가
-- 3) RLS 재활성화
--
-- 대부분의 Supabase 프로젝트가 publishable/anon 키만 사용하면서 정책은
-- 'FOR ALL USING (true)' 같이 사실상 개방으로 두므로 동일 패턴 적용.
-- 정확한 매칭이 필요하면 SELECT 결과를 보고 수정하세요.

-- ── (참고) transactions 테이블의 현재 정책 확인
SELECT policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'transactions';

-- ── material_units 정책 정리 + 재활성화 ─────────────────────────
-- 기존 정책이 있다면 모두 제거 (멱등성 확보)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'material_units'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON material_units', r.policyname);
  END LOOP;
END $$;

-- 개방형 정책 (다른 테이블과 일관성 위해 4종 분리; 한 줄 'FOR ALL'로도 가능)
CREATE POLICY "Enable read access for all users"   ON material_units
  FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users" ON material_units
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users" ON material_units
  FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Enable delete access for all users" ON material_units
  FOR DELETE USING (true);

ALTER TABLE material_units ENABLE ROW LEVEL SECURITY;

-- ── 검증 ────────────────────────────────────────────────────────
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'material_units';

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'material_units'
ORDER BY policyname;
