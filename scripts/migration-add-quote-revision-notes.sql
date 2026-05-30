-- ============================================================
-- 견적 수정 내역 (수동 메모) + 출력 표시 여부
-- ------------------------------------------------------------
--   1. quote_revision_notes : 견적별 수정 내역 1:N (일자 + 내용)
--   2. quotes.show_revisions : 출력물 표시 여부 (기본 FALSE = 미출력)
-- 저장은 작업라인과 동일하게 전체 DELETE 후 INSERT.
-- idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS quote_revision_notes (
  id           SERIAL PRIMARY KEY,
  quote_id     INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  revised_date DATE NOT NULL,
  content      TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_revision_notes_quote ON quote_revision_notes(quote_id);

ALTER TABLE quote_revision_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_quote_revision_notes ON quote_revision_notes;
CREATE POLICY allow_all_quote_revision_notes ON quote_revision_notes FOR ALL USING (TRUE) WITH CHECK (TRUE);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS show_revisions BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';

SELECT 'quote_revision_notes' AS tbl, to_regclass('public.quote_revision_notes') IS NOT NULL AS exists
UNION ALL
SELECT 'quotes.show_revisions',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='show_revisions');
