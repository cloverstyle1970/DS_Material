-- ============================================================
-- 근무복 및 개인안전장구 신청 시스템
-- ------------------------------------------------------------
-- · 신청 → 처리중 → 수령완료 / 취소
-- · 근무복: 상의/하의/안전화 (사이즈 정보 포함)
--   - 수령완료 시점에 users.uniform_top_size / uniform_bottom_size /
--     safety_shoes_size 자동 갱신
-- · 안전장구: 분류코드 D9902 + sub >= '06' 자재 (안전화·안전모·
--   안전벨트·장갑류 등)
-- ============================================================

-- 1. 신청 헤더
CREATE TABLE IF NOT EXISTS uniform_safety_requests (
  id              SERIAL PRIMARY KEY,
  request_type    TEXT        NOT NULL CHECK (request_type IN ('근무복','안전장구')),
  status          TEXT        NOT NULL DEFAULT '신청'
                              CHECK (status IN ('신청','처리중','수령완료','취소')),
  user_id         INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name       TEXT        NOT NULL,
  user_dept       TEXT,
  note            TEXT,                                 -- 비고(신청 사유)
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,                          -- 출고 처리 시각
  processor_id    INTEGER,
  processor_name  TEXT,
  received_at     TIMESTAMPTZ,                          -- 수령완료 시각
  cancel_reason   TEXT
);

CREATE INDEX IF NOT EXISTS idx_usr_user      ON uniform_safety_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_usr_status    ON uniform_safety_requests(status);
CREATE INDEX IF NOT EXISTS idx_usr_requested ON uniform_safety_requests(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_usr_received  ON uniform_safety_requests(received_at DESC);

-- 2. 신청 라인
CREATE TABLE IF NOT EXISTS uniform_safety_request_items (
  id              SERIAL PRIMARY KEY,
  request_id      INTEGER NOT NULL REFERENCES uniform_safety_requests(id) ON DELETE CASCADE,
  material_id     TEXT    NOT NULL REFERENCES materials(id),
  material_name   TEXT    NOT NULL,
  category_label  TEXT,                                 -- '상의' | '하의' | '안전화' | '안전모' 등
  size            TEXT,                                 -- 근무복일 때만 사용
  qty             INTEGER NOT NULL CHECK (qty > 0) DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usri_request  ON uniform_safety_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_usri_material ON uniform_safety_request_items(material_id);

-- 3. RLS
ALTER TABLE uniform_safety_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE uniform_safety_request_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_usr"  ON uniform_safety_requests;
DROP POLICY IF EXISTS "allow_all_usri" ON uniform_safety_request_items;

CREATE POLICY "allow_all_usr"  ON uniform_safety_requests      FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "allow_all_usri" ON uniform_safety_request_items FOR ALL USING (TRUE) WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';

-- 검증
SELECT 'uniform_safety_requests'      AS tbl, (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='uniform_safety_requests')      AS exists
UNION ALL
SELECT 'uniform_safety_request_items', (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='uniform_safety_request_items');
