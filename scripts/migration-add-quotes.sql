-- ============================================================
-- 견적서 시스템 (Phase 1)
-- ------------------------------------------------------------
-- · quote_settings    : 회사 견적 기본값 (직접인건비/간접%/일반관리%/이윤%)
-- · quotes            : 견적서 헤더
-- · quote_items       : 자재비 라인
-- · materials.opinion_text / opinion_image_url : 자재별 1:1 소견서
-- · labor_rates       : 공정별 공임 단가표 (Phase 2 사전 준비)
-- ============================================================

-- 1) 견적 기본값 (단일 행으로 운영, id=1 고정)
CREATE TABLE IF NOT EXISTS quote_settings (
  id                       SMALLINT PRIMARY KEY DEFAULT 1
                           CHECK (id = 1),
  default_direct_labor     INTEGER NOT NULL DEFAULT 0,    -- 기본 직접인건비(원)
  indirect_labor_rate      NUMERIC(5,2) NOT NULL DEFAULT 8.0,  -- 간접인건비율(%)
  overhead_rate            NUMERIC(5,2) NOT NULL DEFAULT 10.0, -- 일반관리비율(%)
  profit_rate              NUMERIC(5,2) NOT NULL DEFAULT 8.0,  -- 이윤율(%)
  company_name             TEXT,
  company_biz_no           TEXT,
  company_address          TEXT,
  company_phone            TEXT,
  company_email            TEXT,
  company_ceo              TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 초기 행 삽입 (이미 있으면 유지)
INSERT INTO quote_settings (id, default_direct_labor, indirect_labor_rate, overhead_rate, profit_rate,
                            company_name, company_biz_no, company_address, company_phone, company_email, company_ceo)
VALUES (1, 0, 8.0, 10.0, 8.0,
        '주식회사 대솔이엘', '128-86-58162',
        '경기 고양 일산동구 숲속마을로 48 702(풍동 신성프라자)',
        '031-938-0257',
        'daesol0257@gmail.com',
        '송영권')
ON CONFLICT (id) DO NOTHING;

-- 2) 자재 소견서 (1:1)
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS opinion_text       TEXT,
  ADD COLUMN IF NOT EXISTS opinion_image_url  TEXT;

-- 3) 견적서 헤더
CREATE TABLE IF NOT EXISTS quotes (
  id                  SERIAL PRIMARY KEY,
  quote_no            TEXT NOT NULL UNIQUE,        -- 예: Q-2026-0001
  quote_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  site_name           TEXT,                         -- 현장명
  elevator_name       TEXT,                         -- 호기
  work_title          TEXT,                         -- 작업명
  customer_name       TEXT,                         -- 고객명
  customer_phone      TEXT,
  -- 금액 스냅샷 (자동계산 결과 보존)
  material_subtotal   INTEGER NOT NULL DEFAULT 0,   -- 자재비 합계
  direct_labor        INTEGER NOT NULL DEFAULT 0,   -- 직접인건비
  indirect_labor      INTEGER NOT NULL DEFAULT 0,   -- 간접인건비
  overhead            INTEGER NOT NULL DEFAULT 0,   -- 일반관리비
  profit              INTEGER NOT NULL DEFAULT 0,   -- 이윤
  truncate_amount     INTEGER NOT NULL DEFAULT 0,   -- 절사금액 (-)
  total_amount        INTEGER NOT NULL DEFAULT 0,   -- 공급가액 (총합)
  -- 사용된 비율(%) 스냅샷
  indirect_labor_rate NUMERIC(5,2) NOT NULL DEFAULT 8.0,
  overhead_rate       NUMERIC(5,2) NOT NULL DEFAULT 10.0,
  profit_rate         NUMERIC(5,2) NOT NULL DEFAULT 8.0,
  -- 메타
  note                TEXT,                          -- 특기사항
  status              TEXT NOT NULL DEFAULT '작성중'
                       CHECK (status IN ('작성중','발행','승인','취소')),
  created_by_id       INTEGER,
  created_by_name     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_date ON quotes(quote_date DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_site ON quotes(site_name);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);

-- 4) 견적서 라인 (자재비)
CREATE TABLE IF NOT EXISTS quote_items (
  id              SERIAL PRIMARY KEY,
  quote_id        INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  material_id     TEXT REFERENCES materials(id),     -- NULL 가능 (수기 입력)
  material_name   TEXT NOT NULL,                     -- 스냅샷
  spec            TEXT,                              -- 규격(modelNo) 스냅샷
  unit            TEXT,                              -- EA, SET 등
  qty             INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price      INTEGER NOT NULL DEFAULT 0,        -- 단가
  amount          INTEGER NOT NULL DEFAULT 0,        -- = qty * unit_price (저장 시 갱신)
  remark          TEXT,                              -- 비고
  -- 소견서 스냅샷 (저장 시점의 자재 소견서 복사)
  opinion_text       TEXT,
  opinion_image_url  TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote    ON quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_material ON quote_items(material_id);

-- 5) 공정별 공임 단가표 (Phase 2 — DB만 사전 준비)
CREATE TABLE IF NOT EXISTS labor_rates (
  id              SERIAL PRIMARY KEY,
  process_code    TEXT NOT NULL UNIQUE,    -- 예: ELEC-001
  process_name    TEXT NOT NULL,           -- 공정명
  category        TEXT,                    -- 분류 (전기/기계 등)
  unit            TEXT,                    -- '인공'/'시간' 등
  unit_price      INTEGER NOT NULL DEFAULT 0,
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labor_rates_active ON labor_rates(is_active) WHERE is_active = TRUE;

-- 6) RLS
ALTER TABLE quote_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_rates    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_quote_settings" ON quote_settings;
DROP POLICY IF EXISTS "allow_all_quotes"         ON quotes;
DROP POLICY IF EXISTS "allow_all_quote_items"    ON quote_items;
DROP POLICY IF EXISTS "allow_all_labor_rates"    ON labor_rates;

CREATE POLICY "allow_all_quote_settings" ON quote_settings FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_quotes"         ON quotes         FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_quote_items"    ON quote_items    FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_labor_rates"    ON labor_rates    FOR ALL USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT 'quote_settings' AS tbl, (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='quote_settings') AS exists
UNION ALL SELECT 'quotes',         (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='quotes')
UNION ALL SELECT 'quote_items',    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='quote_items')
UNION ALL SELECT 'labor_rates',    (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='labor_rates')
UNION ALL SELECT 'materials.opinion_text', (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='materials' AND column_name='opinion_text');
