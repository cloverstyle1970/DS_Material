-- ============================================================
-- 공수표 분류 마스터(대/중 2단) + 항목 FK 연계
-- ------------------------------------------------------------
-- 목적: 공정별 공수표의 대분류·중분류를 독립 마스터로 관리(추가/수정/삭제/정렬)하고,
--       견적서 작성에서 대→중→항목 연쇄 드롭다운으로 선택할 수 있도록 정규화.
--
--   1. labor_categories : 대분류(major)/중분류(mid) 2단 트리
--   2. labor_workload_standards 에 major_id/mid_id FK + detail(보조·층수 통합) 추가
--   3. 기존 49건을 분류 마스터로 자동 이관 (category→major, type_name→mid,
--      subtype+floor_range→detail)
--
-- idempotent: 재실행 안전 (IF NOT EXISTS / ON CONFLICT DO NOTHING / IS DISTINCT FROM 가드).
-- ============================================================

-- ── 1) 분류 마스터 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labor_categories (
  id          SERIAL PRIMARY KEY,
  level       TEXT NOT NULL CHECK (level IN ('major','mid')),
  label       TEXT NOT NULL,
  parent_id   INTEGER REFERENCES labor_categories(id) ON DELETE CASCADE,  -- major 는 NULL
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- major: label 전역 unique / mid: (parent_id, label) unique (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_labor_cat_major ON labor_categories(label)            WHERE level = 'major';
CREATE UNIQUE INDEX IF NOT EXISTS uq_labor_cat_mid   ON labor_categories(parent_id, label) WHERE level = 'mid';
CREATE INDEX IF NOT EXISTS idx_labor_cat_lookup ON labor_categories(level, parent_id, sort_order);

ALTER TABLE labor_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_labor_categories ON labor_categories;
CREATE POLICY allow_all_labor_categories ON labor_categories FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ── 2) 항목에 FK + detail 컬럼 추가 ─────────────────────────
ALTER TABLE labor_workload_standards
  ADD COLUMN IF NOT EXISTS major_id INTEGER REFERENCES labor_categories(id),
  ADD COLUMN IF NOT EXISTS mid_id   INTEGER REFERENCES labor_categories(id),
  ADD COLUMN IF NOT EXISTS detail   TEXT;                 -- 보조구분 + 층수범위 통합 (예: "MR · 30층 이상")

CREATE INDEX IF NOT EXISTS idx_workload_std_cat ON labor_workload_standards(major_id, mid_id);

-- ── 3) 기존 49건 → 분류 마스터 이관 (재실행 안전) ───────────
-- 3a) 대분류
INSERT INTO labor_categories (level, label, sort_order)
SELECT 'major', category, MIN(sort_order)
FROM labor_workload_standards
WHERE category IS NOT NULL AND category <> ''
GROUP BY category
ON CONFLICT (label) WHERE level = 'major' DO NOTHING;

-- 3b) 중분류 (대분류 하위)
INSERT INTO labor_categories (level, label, parent_id, sort_order)
SELECT 'mid', s.type_name, m.id, MIN(s.sort_order)
FROM labor_workload_standards s
JOIN labor_categories m ON m.level = 'major' AND m.label = s.category
WHERE s.type_name IS NOT NULL AND s.type_name <> ''
GROUP BY s.type_name, m.id
ON CONFLICT (parent_id, label) WHERE level = 'mid' DO NOTHING;

-- 3c) 항목 FK 채우기
UPDATE labor_workload_standards s
SET major_id = m.id
FROM labor_categories m
WHERE m.level = 'major' AND m.label = s.category
  AND s.major_id IS DISTINCT FROM m.id;

UPDATE labor_workload_standards s
SET mid_id = mid.id
FROM labor_categories mid
JOIN labor_categories maj ON maj.id = mid.parent_id
WHERE mid.level = 'mid' AND mid.label = s.type_name AND maj.label = s.category
  AND s.mid_id IS DISTINCT FROM mid.id;

-- 3d) detail = 보조구분 · 층수범위 (둘 다 없으면 NULL)
UPDATE labor_workload_standards s
SET detail = NULLIF(CONCAT_WS(' · ', NULLIF(s.subtype, ''), NULLIF(s.floor_range, '')), '')
WHERE s.detail IS NULL;

NOTIFY pgrst, 'reload schema';

-- ── 검증 ────────────────────────────────────────────────────
SELECT 'majors'            AS k, COUNT(*) AS n FROM labor_categories WHERE level = 'major'
UNION ALL SELECT 'mids',            COUNT(*) FROM labor_categories WHERE level = 'mid'
UNION ALL SELECT 'items_total',     COUNT(*) FROM labor_workload_standards
UNION ALL SELECT 'items_w_major',   COUNT(*) FROM labor_workload_standards WHERE major_id IS NOT NULL
UNION ALL SELECT 'items_w_mid',     COUNT(*) FROM labor_workload_standards WHERE mid_id IS NOT NULL;
