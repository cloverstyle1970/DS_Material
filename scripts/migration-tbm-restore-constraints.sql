-- ============================================================
-- TBM 테이블 제약조건 복구
-- ------------------------------------------------------------
-- 신DB 전환 때 컬럼은 옮겨졌으나 UNIQUE / 값 제한 CHECK 가 누락됐다.
-- 그 결과:
--   - 마스터 화면에서 같은 code 를 중복 등록해도 막히지 않음
--   - migration-add-tbm.sql 재실행 시 시드의 ON CONFLICT 가
--     "no unique or exclusion constraint matching" 로 실패
-- 원본(scripts/migration-add-tbm.sql)의 CREATE TABLE 정의와 동일하게 되돌린다.
--
-- 적용 전 확인 완료(2026-07-27): 중복 code 없음, 기존 데이터 전부 CHECK 만족.
-- ADD CONSTRAINT 는 IF NOT EXISTS 를 지원하지 않으므로 DO 블록으로 멱등 처리.
-- ============================================================

DO $$
BEGIN
  -- ── UNIQUE ────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_safety_rules_master_code_key') THEN
    ALTER TABLE public.tbm_safety_rules_master ADD CONSTRAINT tbm_safety_rules_master_code_key UNIQUE (code);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_repair_types_code_key') THEN
    ALTER TABLE public.tbm_repair_types ADD CONSTRAINT tbm_repair_types_code_key UNIQUE (code);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_fault_types_code_key') THEN
    ALTER TABLE public.tbm_fault_types ADD CONSTRAINT tbm_fault_types_code_key UNIQUE (code);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_checklist_items_list_type_label_key') THEN
    ALTER TABLE public.tbm_checklist_items ADD CONSTRAINT tbm_checklist_items_list_type_label_key UNIQUE (list_type, label);
  END IF;

  -- ── 값 제한 CHECK ─────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_safety_rules_master_category_check') THEN
    ALTER TABLE public.tbm_safety_rules_master ADD CONSTRAINT tbm_safety_rules_master_category_check
      CHECK (category IN ('all','electric','repair','maintain','rescue','weld'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_safety_rules_master_season_check') THEN
    ALTER TABLE public.tbm_safety_rules_master ADD CONSTRAINT tbm_safety_rules_master_season_check
      CHECK (season IN ('all','spring','summer','fall','winter'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_checklist_items_list_type_check') THEN
    ALTER TABLE public.tbm_checklist_items ADD CONSTRAINT tbm_checklist_items_list_type_check
      CHECK (list_type IN ('repair','inspect'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_records_mode_check') THEN
    ALTER TABLE public.tbm_records ADD CONSTRAINT tbm_records_mode_check
      CHECK (mode IN ('repair','maintain'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_records_sub_type_check') THEN
    ALTER TABLE public.tbm_records ADD CONSTRAINT tbm_records_sub_type_check
      CHECK (sub_type IN ('inspect','parts','fault'));
  END IF;
END $$;

-- ── 검증 ────────────────────────────────────────────────────
SELECT t.relname AS table_name,
       c.contype AS type,
       c.conname AS constraint_name,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t     ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname LIKE 'tbm%'
  AND (c.contype = 'u' OR (c.contype = 'c' AND pg_get_constraintdef(c.oid) NOT LIKE '%IS NOT NULL%'))
ORDER BY t.relname, c.contype, c.conname;
