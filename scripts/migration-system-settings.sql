-- system_settings: 시스템 전역 설정 key-value 저장소
CREATE TABLE IF NOT EXISTS system_settings (
  key         text PRIMARY KEY,
  value       text,
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_system_settings ON system_settings;
CREATE POLICY allow_all_system_settings ON system_settings
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검증
SELECT key, value, updated_at FROM system_settings;
