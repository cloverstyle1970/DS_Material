-- ============================================================
-- 신DB 적용 — quote_revisions 테이블 + snapshot_quote RPC
-- ------------------------------------------------------------
-- quote-workflow 마이그레이션 중 견적 수정이력/스냅샷 부분만 발췌(신DB 미적용분).
-- idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS quote_revisions (
  id              SERIAL PRIMARY KEY,
  quote_id        INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  revision_no     INTEGER NOT NULL,
  snapshot_header JSONB   NOT NULL,
  snapshot_items  JSONB   NOT NULL,
  change_summary  TEXT,
  changed_by_id   INTEGER,
  changed_by_name TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_revisions_unique UNIQUE (quote_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_quote_revisions_quote_id   ON quote_revisions(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_revisions_changed_at ON quote_revisions(changed_at DESC);

ALTER TABLE quote_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_quote_revisions" ON quote_revisions;
CREATE POLICY "allow_all_quote_revisions" ON quote_revisions FOR ALL USING (TRUE) WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION snapshot_quote(
  p_quote_id   INTEGER,
  p_summary    TEXT DEFAULT NULL,
  p_user_id    INTEGER DEFAULT NULL,
  p_user_name  TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_header JSONB;
  v_items  JSONB;
  v_revno  INTEGER;
BEGIN
  SELECT to_jsonb(q.*) INTO v_header FROM quotes q WHERE q.id = p_quote_id;
  IF v_header IS NULL THEN
    RAISE EXCEPTION '견적서를 찾을 수 없습니다: id=%', p_quote_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(qi.*) ORDER BY qi.sort_order, qi.id), '[]'::jsonb)
    INTO v_items
    FROM quote_items qi WHERE qi.quote_id = p_quote_id;

  SELECT COALESCE(MAX(revision_no), 0) + 1
    INTO v_revno
    FROM quote_revisions WHERE quote_id = p_quote_id;

  INSERT INTO quote_revisions
    (quote_id, revision_no, snapshot_header, snapshot_items, change_summary, changed_by_id, changed_by_name)
  VALUES
    (p_quote_id, v_revno, v_header, v_items, p_summary, p_user_id, p_user_name);

  RETURN v_revno;
END;
$$;

GRANT EXECUTE ON FUNCTION snapshot_quote(INTEGER, TEXT, INTEGER, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'quote_revisions' AS obj, to_regclass('public.quote_revisions') IS NOT NULL AS exists
UNION ALL
SELECT 'snapshot_quote', EXISTS (SELECT 1 FROM pg_proc WHERE proname='snapshot_quote');
