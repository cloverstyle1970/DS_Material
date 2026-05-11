-- ============================================================
-- 공용 차량(사용자 미지정) 지원
--   user_vehicles.user_id 를 NULL 허용으로 변경
--   → 회사차량관리에서 사용자를 "공용 차량"으로 등록할 수 있도록 함
-- ============================================================

ALTER TABLE user_vehicles
  ALTER COLUMN user_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_vehicles' AND column_name = 'user_id';
