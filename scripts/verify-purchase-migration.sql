SET client_encoding = 'UTF8';

-- ── 최종 정합성 재검증 ─────────────────────────────────────
-- 1) sentinel(§) 이 note 에 남아있으면 rewrite 실패
SELECT '경고: sentinel(§) 잔존' AS warning, id, note
FROM transactions
WHERE type = '입고' AND note ~ '§';

-- 2) transactions.note '발주 #N' 에서 N 이 실제 purchase_order_lines.id 에 존재하는지
WITH refs AS (
  SELECT
    t.id AS tx_id,
    t.note,
    (regexp_matches(t.note, '발주\s*#(\d+)', 'g'))[1]::bigint AS ref_line_id
  FROM transactions t
  WHERE t.type = '입고' AND t.note IS NOT NULL AND t.note ~ '발주\s*#\d+'
)
SELECT '경고: 존재하지 않는 line 참조' AS warning, r.tx_id, r.note, r.ref_line_id
FROM refs r
WHERE NOT EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.id = r.ref_line_id)
LIMIT 10;

-- 3) 부분입고 헤더 1건 상세 (부분입고 라인 확인)
SELECT po.id AS header_id, po.order_no, po.status AS header_status,
       l.id AS line_id, l.material_id, l.material_name,
       l.qty, l.received_qty, l.status AS line_status
FROM purchase_orders po
JOIN purchase_order_lines l ON l.order_id = po.id
WHERE po.status = '부분입고'
ORDER BY po.id, l.line_no;

-- 4) 헤더/라인 총합 정합성
SELECT
  (SELECT COUNT(*) FROM purchase_orders)                  AS headers,
  (SELECT COUNT(*) FROM purchase_order_lines)             AS lines,
  (SELECT SUM(qty) FROM purchase_order_lines)             AS total_ordered_qty,
  (SELECT SUM(received_qty) FROM purchase_order_lines)    AS total_received_qty,
  (SELECT SUM(qty) FROM purchase_orders_legacy)           AS legacy_total_qty;
