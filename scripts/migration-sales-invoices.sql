-- 매출 세금계산서 발행내역 (조회 전용 + 엑셀 재업로드)
-- 엑셀 시트 '이엘' 구조를 1:1 매핑. 재업로드 시 전체 교체(TRUNCATE 후 재삽입) 운영.
-- idempotent: IF NOT EXISTS / DROP POLICY ... CREATE POLICY

CREATE TABLE IF NOT EXISTS sales_invoices (
  id            BIGSERIAL PRIMARY KEY,
  row_no        INTEGER,        -- 엑셀 원본 행번호 (정렬/추적)
  year_label    TEXT,           -- "20년"
  month_label   TEXT,           -- "1월"
  category      TEXT,           -- 보수 / 부품  (구분)
  tax_div       TEXT,           -- T / D (과세구분)
  issue_date    DATE,           -- 발행일자 (파싱)
  issue_raw     TEXT,           -- 발행일자 원본 "20.01.02"
  summary       TEXT,           -- 적요(작업내용)
  site_name     TEXT,           -- 현장명
  vendor_name   TEXT,           -- 상호(거래처)
  amount        NUMERIC,        -- 청구금액(VAT포함)
  deposit_date  DATE,           -- 입금일자 (파싱)
  deposit_raw   TEXT,           -- 입금일자 원본 "20.01.14기업"
  deposit_bank  TEXT,           -- 입금 은행 부분 "기업"
  pay_status    TEXT,           -- 완/미/취/중/대/실
  pay_method    TEXT,           -- 결제방식 (지로/카드/현금증빙 등)
  remark        TEXT,           -- 비고
  ledger_no     TEXT,           -- 원장번호
  contact       TEXT,           -- 연락처
  etc           TEXT,           -- 기타
  long_overdue  TEXT,           -- 장기미수처
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 조회 인덱스 (발행일/입금일 정렬·기간, 상태·구분 필터)
CREATE INDEX IF NOT EXISTS idx_sales_invoices_issue_date  ON sales_invoices (issue_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_deposit_date ON sales_invoices (deposit_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_pay_status  ON sales_invoices (pay_status);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_category    ON sales_invoices (category);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_row_no      ON sales_invoices (row_no);

-- RLS (개발 표준: 전체 허용)
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_sales_invoices ON sales_invoices;
CREATE POLICY allow_all_sales_invoices ON sales_invoices FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- 검색 + 집계 RPC (필터 로직 단일화: 목록 페이지 + 합계/미수합계를 한 번에 반환)
-- 이전 시그니처 제거 — 오버로드 충돌 방지
DROP FUNCTION IF EXISTS sales_invoices_search(text,text,text,date,date,boolean,int,int);
DROP FUNCTION IF EXISTS sales_invoices_search(text,text,text,date,date,boolean,int,int,text);
CREATE OR REPLACE FUNCTION sales_invoices_search(
  p_q           text    DEFAULT NULL,
  p_category    text    DEFAULT NULL,
  p_status      text    DEFAULT NULL,
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_unpaid_only boolean DEFAULT false,
  p_limit       int     DEFAULT 50,
  p_offset      int     DEFAULT 0,
  p_tax_div     text    DEFAULT NULL,   -- T(TK) / D(DS)
  p_sort        text    DEFAULT 'issue_date',  -- 정렬 컬럼
  p_dir         text    DEFAULT 'desc'         -- asc / desc
) RETURNS json
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT * FROM sales_invoices si
    WHERE (p_q IS NULL OR p_q = '' OR
           si.site_name   ILIKE '%'||p_q||'%' OR
           si.vendor_name ILIKE '%'||p_q||'%' OR
           si.summary     ILIKE '%'||p_q||'%' OR
           si.ledger_no   ILIKE '%'||p_q||'%')
      AND (p_category IS NULL OR p_category = '' OR si.category = p_category)
      AND (p_status   IS NULL OR p_status   = '' OR si.pay_status = p_status)
      AND (p_tax_div  IS NULL OR p_tax_div  = '' OR si.tax_div = p_tax_div)
      AND (p_from IS NULL OR si.issue_date >= p_from)
      AND (p_to   IS NULL OR si.issue_date <= p_to)
      AND (NOT p_unpaid_only OR si.pay_status = '미')
  )
  SELECT json_build_object(
    'total_count',   (SELECT count(*)               FROM filtered),
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

-- 장기미수 현장 집계 RPC — 미수(미) + 발행 후 p_days 초과 건을 현장별로 묶어 반환
DROP FUNCTION IF EXISTS sales_invoices_overdue_sites(int,text);
DROP FUNCTION IF EXISTS sales_invoices_overdue_sites(int,text,text,text);
CREATE OR REPLACE FUNCTION sales_invoices_overdue_sites(
  p_days     int  DEFAULT 90,    -- 발행경과 기준일 (이 일수 초과 미수)
  p_q        text DEFAULT NULL,  -- 현장명·상호 검색
  p_category text DEFAULT NULL,  -- 보수 / 부품
  p_tax_div  text DEFAULT NULL   -- T(TK) / D(DS)
) RETURNS json
LANGUAGE sql STABLE AS $$
  WITH overdue AS (
    SELECT * FROM sales_invoices si
    WHERE si.pay_status = '미'
      AND si.issue_date IS NOT NULL
      AND si.issue_date <= current_date - make_interval(days => p_days)
      AND (p_q IS NULL OR p_q = '' OR
           si.site_name   ILIKE '%'||p_q||'%' OR
           si.vendor_name ILIKE '%'||p_q||'%')
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

-- 장기미수 현장 상세 — 특정 현장의 미수(미)+경과초과 개별 건 (집계와 동일 필터)
DROP FUNCTION IF EXISTS sales_invoices_overdue_detail(text,int,text,text);
CREATE OR REPLACE FUNCTION sales_invoices_overdue_detail(
  p_site     text,
  p_days     int  DEFAULT 90,
  p_category text DEFAULT NULL,
  p_tax_div  text DEFAULT NULL
) RETURNS json
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(json_agg(t), '[]'::json) FROM (
    SELECT id, issue_date, (current_date - issue_date) AS overdue_days,
           tax_div, category, summary, amount,
           deposit_raw, pay_method, ledger_no, remark
    FROM sales_invoices si
    WHERE si.pay_status = '미' AND si.issue_date IS NOT NULL
      AND si.issue_date <= current_date - make_interval(days => p_days)
      AND si.site_name = p_site
      AND (p_category IS NULL OR p_category = '' OR si.category = p_category)
      AND (p_tax_div  IS NULL OR p_tax_div  = '' OR si.tax_div  = p_tax_div)
    ORDER BY issue_date
  ) t;
$$;

-- 검증
SELECT
  (SELECT count(*) FROM sales_invoices) AS row_count,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'sales_invoices') AS col_count;
