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
-- 이전 시그니처(8인자) 제거 — 오버로드 충돌 방지
DROP FUNCTION IF EXISTS sales_invoices_search(text,text,text,date,date,boolean,int,int);
CREATE OR REPLACE FUNCTION sales_invoices_search(
  p_q           text    DEFAULT NULL,
  p_category    text    DEFAULT NULL,
  p_status      text    DEFAULT NULL,
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_unpaid_only boolean DEFAULT false,
  p_limit       int     DEFAULT 50,
  p_offset      int     DEFAULT 0,
  p_tax_div     text    DEFAULT NULL   -- T(TK) / D(DS)
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
        ORDER BY issue_date DESC NULLS LAST, row_no DESC
        LIMIT p_limit OFFSET p_offset
    ) t), '[]'::json)
  );
$$;

-- 검증
SELECT
  (SELECT count(*) FROM sales_invoices) AS row_count,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'sales_invoices') AS col_count;
