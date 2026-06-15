-- ============================================================
-- sites 테이블에 자재관리용 확장 컬럼 추가 DDL
-- ------------------------------------------------------------
-- Supabase Dashboard ➔ SQL Editor에 붙여넣고 Run 하세요.
-- ============================================================

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS company_type      TEXT,
  ADD COLUMN IF NOT EXISTS contract_type     TEXT,
  ADD COLUMN IF NOT EXISTS contract_date     DATE,
  ADD COLUMN IF NOT EXISTS contract_start    DATE,
  ADD COLUMN IF NOT EXISTS contract_end      DATE,
  ADD COLUMN IF NOT EXISTS main_inspector    TEXT,
  ADD COLUMN IF NOT EXISTS sub_inspector     TEXT,
  ADD COLUMN IF NOT EXISTS sub_inspector2    TEXT,
  ADD COLUMN IF NOT EXISTS site_phone        TEXT,
  ADD COLUMN IF NOT EXISTS site_mobile       TEXT,
  ADD COLUMN IF NOT EXISTS fax               TEXT,
  ADD COLUMN IF NOT EXISTS manager_phone     TEXT,
  ADD COLUMN IF NOT EXISTS manager_email     TEXT,
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS entry_info        TEXT,
  ADD COLUMN IF NOT EXISTS vendor            TEXT,
  ADD COLUMN IF NOT EXISTS customer_email    TEXT,
  ADD COLUMN IF NOT EXISTS job_no            TEXT,
  ADD COLUMN IF NOT EXISTS note              TEXT,
  ADD COLUMN IF NOT EXISTS emergency_device  TEXT,
  ADD COLUMN IF NOT EXISTS emergency_devices TEXT[] DEFAULT '{}';

-- RLS 정책 확인 및 개방형 권한 부여 (이미 존재 시 무시)
DROP POLICY IF EXISTS "allow_all_sites" ON public.sites;
CREATE POLICY "allow_all_sites" ON public.sites FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- Elevators 테이블 개방형 RLS 추가 (이관 오류 방지)
DROP POLICY IF EXISTS "allow_all_elevators" ON public.elevators;
CREATE POLICY "allow_all_elevators" ON public.elevators FOR ALL USING (TRUE) WITH CHECK (TRUE);
