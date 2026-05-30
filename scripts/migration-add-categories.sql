-- ============================================================
-- migration-add-categories.sql
-- ------------------------------------------------------------
-- 자재 분류(대/중/소) 마스터 테이블.
-- 자재품목 관리 → "분류 관리" 모달 (CategoryManagerModal) 및
-- 근무복/안전장구 신청 화면에서 소분류 라벨로 사용.
--
-- · level: 'major'(대분류) | 'mid'(중분류) | 'sub'(소분류)
-- · code:  level 내 2자리 식별자 (01~98, 99는 예약)
-- · major_code / mid_code: 상위 분류의 code (level=major 는 둘 다 NULL)
--
-- 시드 SQL (seed-uniform-safety-categories.sql, cleanup-categories-data.sql)이
-- ON CONFLICT DO NOTHING 으로 동작하도록 level 별 partial unique index 부여.
--
-- 개발 표준대로 RLS 활성 + allow_all 정책. Supabase Dashboard >
-- SQL Editor 에서 1회 실행 (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL      PRIMARY KEY,
  level       TEXT        NOT NULL CHECK (level IN ('major','mid','sub')),
  code        TEXT        NOT NULL,
  label       TEXT        NOT NULL,
  major_code  TEXT,
  mid_code    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 정합성 제약
--   major: code 자체가 전역 unique
--   mid:   (major_code, code) unique
--   sub:   (major_code, mid_code, code) unique
-- partial unique index 로 level 별 분리 (NULL 상위 코드가 unique 비교에 들어오지 않도록).
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_major
  ON categories(code)
  WHERE level = 'major';

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_mid
  ON categories(major_code, code)
  WHERE level = 'mid';

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_sub
  ON categories(major_code, mid_code, code)
  WHERE level = 'sub';

-- 조회/정렬용 인덱스
CREATE INDEX IF NOT EXISTS idx_categories_lookup
  ON categories(level, major_code, mid_code, code);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION categories_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_set_updated_at ON categories;
CREATE TRIGGER trg_categories_set_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION categories_set_updated_at();

-- RLS
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_categories" ON categories;
CREATE POLICY "allow_all_categories"
  ON categories FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- PostgREST 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 검증
-- ============================================================
SELECT 'categories' AS tbl,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'categories') AS exists,
       (SELECT COUNT(*) FROM categories) AS row_count;

SELECT indexname FROM pg_indexes WHERE tablename = 'categories' ORDER BY indexname;
