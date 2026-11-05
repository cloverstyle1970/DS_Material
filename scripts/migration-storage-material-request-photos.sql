-- material-request-photos 버킷 Storage RLS 정책
-- 버킷은 public 이지만 storage.objects 에 정책이 없으면 업로드가 거부된다.

-- 기존 정책 초기화 (idempotent)
DROP POLICY IF EXISTS "allow_auth_upload_material_photos"  ON storage.objects;
DROP POLICY IF EXISTS "allow_auth_select_material_photos"  ON storage.objects;
DROP POLICY IF EXISTS "allow_auth_delete_material_photos"  ON storage.objects;
DROP POLICY IF EXISTS "allow_anon_select_material_photos"  ON storage.objects;

-- 인증 사용자: 업로드 허용
CREATE POLICY "allow_auth_upload_material_photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'material-request-photos');

-- 인증 사용자: 조회 허용
CREATE POLICY "allow_auth_select_material_photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'material-request-photos');

-- 인증 사용자: 삭제 허용 (본인 업로드 파일)
CREATE POLICY "allow_auth_delete_material_photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'material-request-photos');

-- 비인증(public) 사용자: 조회 허용 (public 버킷 URL 접근)
CREATE POLICY "allow_anon_select_material_photos"
ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'material-request-photos');

-- 검증
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE '%material_photos%';
