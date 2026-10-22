-- ── 자재 파트번호 통합 (merge) 지원
-- 목적: 중복 등록된 파트번호를 하나로 통합하되 기존 트랜잭션·발주 이력은 보존
--
-- 추가 컬럼:
--   materials.is_active    BOOLEAN DEFAULT TRUE  — false = 비활성(통합됨)
--   materials.merged_into  TEXT FK               — 통합된 대상 파트번호
--
-- 배포: Supabase Dashboard → SQL Editor에서 실행
-- idempotent: 재실행 안전

-- ── 1) 컬럼 추가 ────────────────────────────────────────────────
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS merged_into TEXT    REFERENCES materials(id);

CREATE INDEX IF NOT EXISTS idx_materials_is_active   ON materials(is_active);
CREATE INDEX IF NOT EXISTS idx_materials_merged_into ON materials(merged_into);

-- ── 2) merge_materials RPC ──────────────────────────────────────
-- p_source_id : 통합될(비활성화될) 구 파트번호
-- p_target_id : 유지될 마스터 파트번호
-- 재고가 있으면 이관 트랜잭션(type='재고이관')을 생성하고 재고 이전.
-- 소스 자재: is_active=false, merged_into=target, stock_qty=0
DROP FUNCTION IF EXISTS merge_materials(text, text, integer, text);

CREATE OR REPLACE FUNCTION merge_materials(
  p_source_id  TEXT,
  p_target_id  TEXT,
  p_user_id    INTEGER,
  p_user_name  TEXT
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_source_stock  INTEGER;
  v_target_stock  INTEGER;
  v_source_name   TEXT;
  v_target_name   TEXT;
BEGIN
  -- 소스·타겟 존재 및 재고 확인 (FOR UPDATE 잠금)
  SELECT stock_qty, name INTO v_source_stock, v_source_name
  FROM materials WHERE id = p_source_id FOR UPDATE;
  IF v_source_stock IS NULL THEN
    RETURN json_build_object('error', '원본 자재를 찾을 수 없습니다: ' || p_source_id);
  END IF;

  SELECT stock_qty, name INTO v_target_stock, v_target_name
  FROM materials WHERE id = p_target_id FOR UPDATE;
  IF v_target_stock IS NULL THEN
    RETURN json_build_object('error', '대상 자재를 찾을 수 없습니다: ' || p_target_id);
  END IF;

  IF p_source_id = p_target_id THEN
    RETURN json_build_object('error', '원본과 대상이 동일합니다.');
  END IF;

  -- 재고 이관 트랜잭션 생성 (재고가 있을 때만)
  IF v_source_stock > 0 THEN
    INSERT INTO transactions(
      type, material_id, material_name, qty, prev_stock, after_stock,
      note, user_id, user_name, created_at
    ) VALUES (
      '출고', p_source_id, v_source_name, v_source_stock, v_source_stock, 0,
      '파트번호 통합 이관 → ' || p_target_id, p_user_id, p_user_name, now()
    );

    INSERT INTO transactions(
      type, material_id, material_name, qty, prev_stock, after_stock,
      note, user_id, user_name, created_at
    ) VALUES (
      '입고', p_target_id, v_target_name, v_source_stock, v_target_stock, v_target_stock + v_source_stock,
      '파트번호 통합 이관 ← ' || p_source_id, p_user_id, p_user_name, now()
    );

    UPDATE materials SET stock_qty = 0                               WHERE id = p_source_id;
    UPDATE materials SET stock_qty = v_target_stock + v_source_stock WHERE id = p_target_id;
  END IF;

  -- 소스 비활성화
  UPDATE materials
  SET is_active   = FALSE,
      merged_into = p_target_id
  WHERE id = p_source_id;

  RETURN json_build_object(
    'ok',            true,
    'transferredQty', v_source_stock,
    'targetStockAfter', v_target_stock + v_source_stock
  );
END;
$$;

-- ── 3) 검증 ────────────────────────────────────────────────────
SELECT
  'materials.is_active'   AS chk,
  COUNT(*) AS col_exists
FROM information_schema.columns
WHERE table_name = 'materials' AND column_name = 'is_active'
UNION ALL
SELECT
  'materials.merged_into',
  COUNT(*)
FROM information_schema.columns
WHERE table_name = 'materials' AND column_name = 'merged_into'
UNION ALL
SELECT
  'merge_materials fn',
  COUNT(*)
FROM pg_proc
WHERE proname = 'merge_materials';
