// vendors 테이블 생성 + 928행을 구DB→신DB 이전 + RLS 개방
// 실행: node --env-file=.env.local scripts/db-migrate-vendors.mjs
import { sourceClient, targetClient } from "./db-conn.mjs";

const src = await sourceClient();
const tgt = await targetClient();

// 1) 테이블 생성 (FK 없음, id serial)
await tgt.query(`
  CREATE TABLE IF NOT EXISTS public.vendors (
    id              SERIAL PRIMARY KEY,
    vendor_code     TEXT,
    name            TEXT NOT NULL,
    biz_no          TEXT,
    representative  TEXT,
    biz_type        TEXT,
    biz_item        TEXT,
    postal_code     TEXT,
    address         TEXT,
    phone           TEXT,
    fax             TEXT,
    invoice_manager TEXT,
    invoice_email   TEXT,
    type            TEXT NOT NULL DEFAULT '매입',
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );`);
await tgt.query(`ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY`);
await tgt.query(`DROP POLICY IF EXISTS allow_all_vendors ON public.vendors`);
await tgt.query(`CREATE POLICY allow_all_vendors ON public.vendors FOR ALL USING (TRUE) WITH CHECK (TRUE)`);
console.log("✅ vendors 테이블 + RLS 준비 완료");

// 2) 데이터 이전 (id 보존, 페이지네이션)
const cols = ["id","vendor_code","name","biz_no","representative","biz_type","biz_item","postal_code","address","phone","fax","invoice_manager","invoice_email","type","created_at"];
const rows = (await src.query(`select ${cols.join(",")} from vendors order by id`)).rows;
console.log(`구DB vendors ${rows.length}행 → 이전 중...`);

let inserted = 0;
const CHUNK = 200;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  // 다중 VALUES 한 번에
  const valuesSql = [];
  const params = [];
  let p = 1;
  for (const r of chunk) {
    valuesSql.push(`(${cols.map(() => `$${p++}`).join(",")})`);
    for (const c of cols) params.push(r[c]);
  }
  const r = await tgt.query(
    `INSERT INTO public.vendors(${cols.join(",")}) VALUES ${valuesSql.join(",")} ON CONFLICT (id) DO NOTHING`,
    params
  );
  inserted += r.rowCount;
}
console.log(`${inserted}건 삽입`);

// 3) 시퀀스 동기화
await tgt.query(`SELECT setval(pg_get_serial_sequence('vendors','id'), COALESCE((SELECT MAX(id) FROM vendors),1))`);

// 4) 검증
const after = await tgt.query(`select count(*)::int n, count(*) filter (where type='매입')::int 매입, count(*) filter (where type='매출')::int 매출 from vendors`);
console.log("신DB vendors:", JSON.stringify(after.rows[0]));

await src.end(); await tgt.end();
