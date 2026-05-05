-- material_units 테이블 RLS 비활성화
-- 신규 테이블 생성 시 자동 켜지는 RLS가 anon/publishable 키로의 INSERT를 막아
-- "new row violates row-level security policy" 오류가 발생.
-- 이 프로젝트의 다른 테이블(materials, transactions 등)과 일관되게 RLS 끄기.

ALTER TABLE material_units DISABLE ROW LEVEL SECURITY;

-- 확인
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('materials', 'transactions', 'material_units', 'sites', 'elevators', 'vendors', 'users');
