-- 매출 계산서 검색 RPC 에 현장 별칭·검색키워드 매칭 추가
-- managed_sites.alias / search_keywords 로도 현장명 검색이 되도록 EXISTS 서브쿼리 추가.
-- idempotent: DROP + CREATE OR REPLACE.

-- 1) sales_invoices_search ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS sales_invoices_search(text,text,text,date,date,boolean,int,int,text);
DROP FUNCTION IF EXISTS sales_invoices_search(text,text,text,date,date,boolean,int,int,text,text,text);
CREATE OR REPLACE FUNCTION sales_invoices_search(
  p_q           text    DEFAULT NULL,
  p_category    text    DEFAULT NULL,
  p_status      text    DEFAULT NULL,
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_unpaid_only boolean DEFAULT false,
  p_limit       int     DEFAULT 50,
  p_offset      int     DEFAULT 0,
  p_tax_div     text    DEFAULT NULL,
  p_sort        text    DEFAULT 'issue_date',
  p_dir         text    DEFAULT 'desc'
) RETURNS json
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT si.* FROM sales_invoices si
    WHERE (p_q IS NULL OR p_q = '' OR
           si.site_name   ILIKE '%'||p_q||'%' OR
           si.vendor_name ILIKE '%'||p_q||'%' OR
           si.summary     ILIKE '%'||p_q||'%' OR
           si.ledger_no   ILIKE '%'||p_q||'%' OR
           EXISTS (
             SELECT 1 FROM managed_sites ms
             WHERE ms.site_name = si.site_name
               AND (ms.alias ILIKE '%'||p_q||'%' OR ms.search_keywords ILIKE '%'||p_q||'%')
           ))
      AND (p_category IS NULL OR p_category = '' OR si.category = p_category)
      AND (p_status   IS NULL OR p_status   = '' OR si.pay_status = p_status)
      AND (p_tax_div  IS NULL OR p_tax_div  = '' OR si.tax_div = p_tax_div)
      AND (p_from IS NULL OR si.issue_date >= p_from)
      AND (p_to   IS NULL OR si.issue_date <= p_to)
      AND (NOT p_unpaid_only OR si.pay_status = '미')
  )
  SELECT json_build_object(
    'total_count',   (SELECT count(*)                FROM filtered),
    'total_amount',  (SELECT COALESCE(sum(amount),0) FROM filtered),
    'unpaid_amount', (SELECT COALESCE(sum(amount),0) FROM filtered WHERE pay_status = '미'),
    'rows', COALESCE((SELECT json_agg(t) FROM (
        SELECT * FROM filtered
        ORDER BY
          CASE WHEN p_sort='issue_date'   AND p_dir='asc'  THEN issue_date   END ASC  NULLS LAST,
          CASE WHEN p_sort='issue_date'   AND p_dir='desc' THEN issue_date   END DESC NULLS LAST,
          CASE WHEN p_sort='amount'       AND p_dir='asc'  THEN amount       END ASC  NULLS LAST,
          CASE WHEN p_sort='amount'       AND p_dir='desc' THEN amount       END DESC NULLS LAST,
          CASE WHEN p_sort='deposit_date' AND p_dir='asc'  THEN deposit_date END ASC  NULLS LAST,
          CASE WHEN p_sort='deposit_date' AND p_dir='desc' THEN deposit_date END DESC NULLS LAST,
          CASE WHEN p_sort='pay_status'   AND p_dir='asc'  THEN pay_status   END ASC  NULLS LAST,
          CASE WHEN p_sort='pay_status'   AND p_dir='desc' THEN pay_status   END DESC NULLS LAST,
          CASE WHEN p_sort='site_name'    AND p_dir='asc'  THEN site_name    END ASC  NULLS LAST,
          CASE WHEN p_sort='site_name'    AND p_dir='desc' THEN site_name    END DESC NULLS LAST,
          CASE WHEN p_sort='vendor_name'  AND p_dir='asc'  THEN vendor_name  END ASC  NULLS LAST,
          CASE WHEN p_sort='vendor_name'  AND p_dir='desc' THEN vendor_name  END DESC NULLS LAST,
          CASE WHEN p_sort='category'     AND p_dir='asc'  THEN category     END ASC  NULLS LAST,
          CASE WHEN p_sort='category'     AND p_dir='desc' THEN category     END DESC NULLS LAST,
          CASE WHEN p_sort='tax_div'      AND p_dir='asc'  THEN tax_div      END ASC  NULLS LAST,
          CASE WHEN p_sort='tax_div'      AND p_dir='desc' THEN tax_div      END DESC NULLS LAST,
          issue_date DESC NULLS LAST, row_no DESC
        LIMIT p_limit OFFSET p_offset
    ) t), '[]'::json)
  );
$$;

-- 2) sales_invoices_overdue_sites ─────────────────────────────────────────
DROP FUNCTION IF EXISTS sales_invoices_overdue_sites(int,text,text,text);
CREATE OR REPLACE FUNCTION sales_invoices_overdue_sites(
  p_days     int  DEFAULT 90,
  p_q        text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_tax_div  text DEFAULT NULL
) RETURNS json
LANGUAGE sql STABLE AS $$
  WITH overdue AS (
    SELECT si.* FROM sales_invoices si
    WHERE si.pay_status = '미'
      AND si.issue_date IS NOT NULL
      AND si.issue_date <= current_date - make_interval(days => p_days)
      AND (p_q IS NULL OR p_q = '' OR
           si.site_name   ILIKE '%'||p_q||'%' OR
           si.vendor_name ILIKE '%'||p_q||'%' OR
           EXISTS (
             SELECT 1 FROM managed_sites ms
             WHERE ms.site_name = si.site_name
               AND (ms.alias ILIKE '%'||p_q||'%' OR ms.search_keywords ILIKE '%'||p_q||'%')
           ))
      AND (p_category IS NULL OR p_category = '' OR si.category = p_category)
      AND (p_tax_div  IS NULL OR p_tax_div  = '' OR si.tax_div  = p_tax_div)
  ),
  grouped AS (
    SELECT
      site_name,
      (array_agg(vendor_name ORDER BY issue_date DESC))[1] AS vendor_name,
      (array_agg(contact ORDER BY issue_date DESC) FILTER (WHERE contact IS NOT NULL))[1] AS contact,
      count(*)              AS unpaid_count,
      sum(amount)           AS unpaid_amount,
      min(issue_date)       AS oldest_issue,
      max(issue_date)       AS newest_issue,
      (current_date - min(issue_date)) AS overdue_days
    FROM overdue
    GROUP BY site_name
  )
  SELECT json_build_object(
    'site_count',   (SELECT count(*)                   FROM grouped),
    'total_count',  (SELECT COALESCE(sum(unpaid_count),0)  FROM grouped),
    'total_amount', (SELECT COALESCE(sum(unpaid_amount),0) FROM grouped),
    'rows', COALESCE((SELECT json_agg(t) FROM (
        SELECT * FROM grouped
        ORDER BY overdue_days DESC, unpaid_amount DESC NULLS LAST
    ) t), '[]'::json)
  );
$$;

-- 검증: 함수 재생성 확인
SELECT proname, pg_get_function_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('sales_invoices_search', 'sales_invoices_overdue_sites')
ORDER BY proname;
