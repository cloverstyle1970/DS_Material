SET client_encoding = 'UTF8';

-- ================================================================
-- purchase_orders 헤더/라인 분리 마이그레이션 (B안)
-- ================================================================
-- 목적: 부분입고(같은 발주에서 일부 수량/일부 품목만 선입고)를 정식 지원.
-- 기존: purchase_orders 한 테이블에 라인당 1행. batch_id로 헤더를 흉내냄.
-- 변경: purchase_orders = 헤더(발주서 단위) + purchase_order_lines = 품목별 라인
--
-- 실행: 저장된 신DB Postgres 좌표(aws-1-ap-northeast-2 pooler)로
--       `psql` 또는 `pg` 클라이언트에서 한 번에 실행.
-- 롤백: 문제 발생 시 아래 순서로 복원:
--   BEGIN;
--     DROP TABLE purchase_order_lines;
--     DROP TABLE purchase_orders;
--     ALTER TABLE purchase_orders_legacy RENAME TO purchase_orders;
--   COMMIT;
-- Idempotent: 재실행해도 안전. legacy 가 이미 존재하면 이관 단계는 스킵.
-- 핵심 트릭:
--   1) 헤더 id = 그룹 대표 legacy id 재사용 → notifications.ref_id 자동 유효
--   2) group_key → new_order_id 매핑이 자명 (batch_id 그룹 대표 = MIN(legacy_id))
--   3) 라인 id 는 SERIAL 신규 채번 후 매핑 테이블 유지
--   4) transactions.note "발주 #<legacy_id>" 를 "발주 #<new_line_id>" 로 rewrite
-- ================================================================

BEGIN;

-- ── 1. legacy 백업 (idempotent) ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='purchase_orders_legacy') THEN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='purchase_orders') THEN
      -- 스키마 검증: 신 스키마가 이미 적용된 상태(order_ref_no 존재)면 skip
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='purchase_orders' AND column_name='order_ref_no'
      ) THEN
        ALTER TABLE purchase_orders RENAME TO purchase_orders_legacy;
      END IF;
    END IF;
  END IF;
END $$;

-- ── 2. 신 purchase_orders (헤더) ────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id             BIGINT PRIMARY KEY,                          -- SERIAL 아님: legacy 대표 id 재사용
  order_no       TEXT,
  status         TEXT NOT NULL DEFAULT '발주',                -- 발주 | 부분입고 | 입고완료 | 취소
  vendor_name    TEXT,
  site_name      TEXT,
  requester_name TEXT,
  ordered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at    TIMESTAMPTZ,
  order_ref_no   TEXT,
  form_type      TEXT NOT NULL DEFAULT '기본',                -- 기본 | 긴급 | 수리
  note           TEXT,
  user_id        BIGINT NOT NULL,
  user_name      TEXT NOT NULL,
  ship_to        TEXT,
  ship_due_date  TEXT,
  ship_receiver  TEXT,
  ship_contact   TEXT,
  ship_manager   TEXT,
  ship_note      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 헤더용 시퀀스 (legacy 이관 후 MAX 로 갱신)
CREATE SEQUENCE IF NOT EXISTS purchase_orders_id_seq;
ALTER TABLE purchase_orders
  ALTER COLUMN id SET DEFAULT nextval('purchase_orders_id_seq');
ALTER SEQUENCE purchase_orders_id_seq OWNED BY purchase_orders.id;

CREATE INDEX IF NOT EXISTS purchase_orders_status_idx     ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS purchase_orders_ordered_at_idx ON purchase_orders(ordered_at DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_order_no_idx   ON purchase_orders(order_no);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_purchase_orders ON purchase_orders;
CREATE POLICY allow_all_purchase_orders ON purchase_orders FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ── 3. 신 purchase_order_lines (라인) ───────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id            BIGSERIAL PRIMARY KEY,
  order_id      BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL DEFAULT 1,
  material_id   TEXT NOT NULL,
  material_name TEXT NOT NULL,
  qty           INTEGER NOT NULL CHECK (qty > 0),
  received_qty  INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  unit_price    NUMERIC,
  elevator_name TEXT,
  request_id    BIGINT,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT '발주',                  -- 발주 | 부분입고 | 입고완료 | 취소
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchase_order_lines_order_id_idx    ON purchase_order_lines(order_id);
CREATE INDEX IF NOT EXISTS purchase_order_lines_material_id_idx ON purchase_order_lines(material_id);
CREATE INDEX IF NOT EXISTS purchase_order_lines_status_idx      ON purchase_order_lines(status);
CREATE INDEX IF NOT EXISTS purchase_order_lines_request_id_idx  ON purchase_order_lines(request_id);

ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_purchase_order_lines ON purchase_order_lines;
CREATE POLICY allow_all_purchase_order_lines ON purchase_order_lines FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ── 4. 데이터 이관 (legacy 존재하고 신 테이블 비어있을 때만) ─────
DO $$
DECLARE
  legacy_count BIGINT := 0;
  header_count BIGINT := 0;
  line_count   BIGINT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='purchase_orders_legacy') THEN
    RAISE NOTICE 'legacy 없음 — 이관 스킵';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO legacy_count FROM purchase_orders_legacy;
  SELECT COUNT(*) INTO header_count FROM purchase_orders;

  IF legacy_count = 0 THEN
    RAISE NOTICE 'legacy 비어있음 — 이관 스킵';
    RETURN;
  END IF;

  IF header_count > 0 THEN
    RAISE NOTICE '신 purchase_orders 에 이미 % 건 존재 — 이관 스킵 (중복 방지)', header_count;
    RETURN;
  END IF;

  -- 4-1. 매핑 테이블 (마이그레이션 후 사용자 확인용으로 유지. 필요 시 수동 DROP)
  DROP TABLE IF EXISTS purchase_orders_migration_map;
  CREATE TABLE purchase_orders_migration_map (
    legacy_id     BIGINT PRIMARY KEY,
    new_order_id  BIGINT NOT NULL,
    new_line_id   BIGINT NOT NULL,
    is_head       BOOLEAN NOT NULL DEFAULT FALSE
  );

  -- 4-2. 헤더 INSERT: batch_id 그룹의 MIN(legacy id)를 헤더 id 로 재사용.
  --      note 에서 [orderRefNo][긴급|수리] 태그 분리.
  INSERT INTO purchase_orders (
    id, order_no, status, vendor_name, site_name, requester_name,
    ordered_at, received_at, order_ref_no, form_type, note,
    user_id, user_name,
    ship_to, ship_due_date, ship_receiver, ship_contact, ship_manager, ship_note,
    created_at, updated_at
  )
  SELECT
    h.id                                        AS id,
    h.order_no,
    '발주'                                       AS status,   -- 나중에 라인 상태로 재계산
    h.vendor_name, h.site_name, h.requester_name,
    h.ordered_at,
    NULL                                         AS received_at,  -- 나중에 재계산
    -- note 태그 중 '긴급'/'수리' 가 아닌 첫 [XXX] 를 order_ref_no 로
    (
      SELECT NULLIF(m[1], '')
      FROM regexp_matches(COALESCE(h.note, ''), '\[([^\]]+)\]', 'g') m
      WHERE m[1] NOT IN ('긴급','수리')
      LIMIT 1
    )                                            AS order_ref_no,
    COALESCE(
      (SELECT m[1]
       FROM regexp_matches(COALESCE(h.note, ''), '\[(긴급|수리)\]', 'g') m
       LIMIT 1),
      '기본'
    )                                            AS form_type,
    NULLIF(TRIM(regexp_replace(COALESCE(h.note, ''), '^(\[[^\]]+\]\s*)+', '')), '')
                                                 AS note,
    h.user_id, h.user_name,
    h.ship_to, h.ship_due_date, h.ship_receiver, h.ship_contact, h.ship_manager, h.ship_note,
    h.ordered_at, h.ordered_at
  FROM (
    SELECT
      COALESCE(batch_id::text, 'solo-' || id::text) AS group_key,
      MIN(id) AS head_id
    FROM purchase_orders_legacy
    GROUP BY COALESCE(batch_id::text, 'solo-' || id::text)
  ) g
  JOIN purchase_orders_legacy h ON h.id = g.head_id;

  -- 4-3. 라인 INSERT: 모든 legacy 행 → 라인
  --      order_id 는 그룹의 MIN(legacy id) (헤더 id 로 재사용된 값)
  --      line_no 는 그룹 내 legacy id 정렬 순서
  WITH ordered_legacy AS (
    SELECT
      l.*,
      COALESCE(l.batch_id::text, 'solo-' || l.id::text) AS group_key,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(l.batch_id::text, 'solo-' || l.id::text)
        ORDER BY l.id
      ) AS line_no_calc,
      MIN(l.id) OVER (
        PARTITION BY COALESCE(l.batch_id::text, 'solo-' || l.id::text)
      ) AS head_legacy_id
    FROM purchase_orders_legacy l
  ),
  inserted AS (
    INSERT INTO purchase_order_lines (
      order_id, line_no, material_id, material_name, qty, received_qty,
      unit_price, elevator_name, request_id, note, status,
      created_at, updated_at
    )
    SELECT
      ol.head_legacy_id, ol.line_no_calc,
      ol.material_id, ol.material_name, ol.qty,
      CASE WHEN ol.status = '입고완료' THEN ol.qty ELSE 0 END,
      ol.unit_price, ol.elevator_name, ol.request_id,
      NULLIF(TRIM(regexp_replace(COALESCE(ol.note, ''), '^(\[[^\]]+\]\s*)+', '')), ''),
      CASE
        WHEN ol.status = '취소'     THEN '취소'
        WHEN ol.status = '입고완료' THEN '입고완료'
        ELSE '발주'
      END,
      ol.ordered_at, ol.ordered_at
    FROM ordered_legacy ol
    RETURNING id, order_id, line_no
  )
  -- 매핑 저장: legacy_id ↔ new_line_id
  INSERT INTO purchase_orders_migration_map (legacy_id, new_order_id, new_line_id, is_head)
  SELECT
    ol.id, ol.head_legacy_id, i.id, (ol.id = ol.head_legacy_id)
  FROM ordered_legacy ol
  JOIN inserted i
    ON i.order_id = ol.head_legacy_id
   AND i.line_no  = ol.line_no_calc;

  -- 4-4. 헤더 status/received_at 재계산
  UPDATE purchase_orders po
  SET status      = agg.new_status,
      received_at = agg.received_at_calc
  FROM (
    SELECT
      l.order_id,
      CASE
        WHEN COUNT(*) FILTER (WHERE l.status = '취소') = COUNT(*)         THEN '취소'
        WHEN COUNT(*) FILTER (WHERE l.status = '입고완료') = COUNT(*)      THEN '입고완료'
        WHEN COUNT(*) FILTER (WHERE l.received_qty > 0) > 0               THEN '부분입고'
        ELSE '발주'
      END AS new_status,
      -- received_at: 모든 라인 완료면 legacy 대표행 received_at, 아니면 NULL
      CASE
        WHEN COUNT(*) FILTER (WHERE l.status = '입고완료') = COUNT(*)
        THEN (SELECT lg.received_at FROM purchase_orders_legacy lg WHERE lg.id = l.order_id LIMIT 1)
        ELSE NULL
      END AS received_at_calc
    FROM purchase_order_lines l
    GROUP BY l.order_id
  ) agg
  WHERE po.id = agg.order_id;

  -- 4-5. 헤더 시퀀스 재조정 (legacy 최대 id + 1 부터 신규 채번)
  PERFORM setval(
    'purchase_orders_id_seq',
    GREATEST((SELECT MAX(id) FROM purchase_orders), 1),
    TRUE
  );

  SELECT COUNT(*) INTO line_count FROM purchase_order_lines;

  RAISE NOTICE '이관 완료 — legacy % 건 → 헤더 % 건 / 라인 % 건',
    legacy_count, (SELECT COUNT(*) FROM purchase_orders), line_count;
END $$;

-- ── 5. transactions.note rewrite ────────────────────────────────
--    "발주 #<legacy_id>" 를 "발주 #<new_line_id>" 로 치환.
--    두 단계로 진행 (rewrite 결과가 다른 legacy id 와 재매칭되는 것을 방지):
--      1) 각 매핑을 sentinel 포맷 "발주 §<new_id>§" 로 rewrite
--      2) sentinel 을 최종 "발주 #<new_id>" 로 복원
DO $$
DECLARE
  rec         RECORD;
  step1_total BIGINT := 0;
  step1_now   BIGINT := 0;
  step2_total BIGINT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='purchase_orders_migration_map') THEN
    RAISE NOTICE '매핑 테이블 없음 — transactions.note rewrite 스킵';
    RETURN;
  END IF;

  -- 1단계: 각 legacy id → sentinel 포맷
  FOR rec IN
    SELECT legacy_id, new_line_id
    FROM purchase_orders_migration_map
    ORDER BY legacy_id DESC  -- 큰 id 부터 (짧은 접두어 매칭 방지)
  LOOP
    UPDATE transactions
    SET note = regexp_replace(
                 note,
                 '(발주\s*#)' || rec.legacy_id::text || '(\D|$)',
                 '\1§' || rec.new_line_id::text || '§\2',
                 'g'
               )
    WHERE type = '입고'
      AND note IS NOT NULL
      AND note ~ ('발주\s*#' || rec.legacy_id::text || '(\D|$)');
    GET DIAGNOSTICS step1_now = ROW_COUNT;
    step1_total := step1_total + step1_now;
  END LOOP;

  -- 2단계: sentinel → 정상 포맷
  UPDATE transactions
  SET note = regexp_replace(note, '(발주\s*#)§(\d+)§', '\1\2', 'g')
  WHERE type = '입고'
    AND note IS NOT NULL
    AND note ~ '§\d+§';
  GET DIAGNOSTICS step2_total = ROW_COUNT;

  RAISE NOTICE 'transactions.note rewrite: 1단계 % 회 update, 2단계 % 건 정리', step1_total, step2_total;
END $$;

-- ── 6. notifications.ref_id 재매핑 ──────────────────────────────
--    ref_type='purchase_order' 의 ref_id 를 legacy → new_order_id 로.
--    (헤더 id 는 legacy 대표 id 재사용이라 대부분 자동 유효하지만,
--     대표가 아닌 legacy id 를 참조한 알림은 헤더 id 로 rewrite 필요.)
DO $$
DECLARE
  updated_count BIGINT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='purchase_orders_migration_map')
     OR NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='notifications') THEN
    RAISE NOTICE '매핑 테이블 또는 notifications 없음 — 재매핑 스킵';
    RETURN;
  END IF;

  UPDATE notifications n
  SET ref_id = mm.new_order_id
  FROM purchase_orders_migration_map mm
  WHERE n.ref_type = 'purchase_order'
    AND n.ref_id   = mm.legacy_id
    AND n.ref_id  <> mm.new_order_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'notifications.ref_id 재매핑: % 건 갱신', updated_count;
END $$;

COMMIT;

-- ── 7. 검증 ─────────────────────────────────────────────────────
SELECT '--- 마이그레이션 검증 ---' AS section;

SELECT
  (SELECT COUNT(*) FROM purchase_orders_legacy)          AS legacy_rows,
  (SELECT COUNT(*) FROM purchase_orders)                 AS new_headers,
  (SELECT COUNT(*) FROM purchase_order_lines)            AS new_lines,
  (SELECT COUNT(*) FROM purchase_orders_migration_map)   AS mapping_rows;

-- 상태별 헤더/라인 분포
SELECT '헤더 상태' AS kind, status, COUNT(*) AS cnt FROM purchase_orders      GROUP BY status
UNION ALL
SELECT '라인 상태' AS kind, status, COUNT(*) AS cnt FROM purchase_order_lines GROUP BY status
ORDER BY kind, cnt DESC;

-- 부분입고 예시
SELECT id, order_id, material_id, material_name, qty, received_qty, status
FROM purchase_order_lines
WHERE received_qty > 0 AND received_qty < qty
LIMIT 20;

-- transactions.note rewrite 검증 (legacy 참조가 남아있으면 안 됨)
SELECT '경고: legacy 참조 잔존' AS warning, t.id, t.note
FROM transactions t
WHERE t.type = '입고'
  AND t.note IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM purchase_orders_migration_map mm
    WHERE t.note ~ ('발주\s*#' || mm.legacy_id::text || '(\D|$)')
      AND mm.legacy_id <> mm.new_line_id  -- 같으면 문제 아님 (rewrite 불필요)
  )
LIMIT 10;

-- 헤더/라인 정합성: 라인 없는 헤더가 있으면 안 됨
SELECT '경고: 라인 없는 헤더' AS warning, po.id, po.order_no
FROM purchase_orders po
LEFT JOIN purchase_order_lines l ON l.order_id = po.id
WHERE l.id IS NULL
LIMIT 10;
