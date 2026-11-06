// RLS 영향을 배제하고 Postgres 직접 접속으로 집계
import pg from "pg";
import { readFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter(l => l && !l.startsWith("#"))
    .map(l => l.split("=")).filter(p => p.length >= 2)
    .map(p => [p[0].trim(), p.slice(1).join("=").trim()])
);

const client = new pg.Client({
  host: env.TARGET_DB_HOST,
  user: env.TARGET_DB_USER,
  password: env.TARGET_DB_PASSWORD,
  port: 5432,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const tables = [
  "material_requests",
  "quote_requests",
  "quote_request_items",
  "purchase_orders",
  "purchase_order_lines",
];
console.log("Postgres 직접 접속 — 서버에서 본 실제 행 수:\n");
for (const t of tables) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM public.${t}`);
  console.log(`  ${t}: ${rows[0].c}건`);
}

// request_type 별
const { rows: byType } = await client.query(`
  SELECT COALESCE(request_type,'(null)') AS t, COUNT(*)::int AS c
  FROM public.material_requests GROUP BY t ORDER BY c DESC
`);
console.log("\nmaterial_requests.request_type 집계:");
for (const r of byType) console.log(`  ${r.t}: ${r.c}건`);

// quote_requests 컬럼 확인
const { rows: cols } = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='quote_requests' ORDER BY ordinal_position
`);
console.log("\nquote_requests 컬럼:", cols.map(c => c.column_name).join(", "));

await client.end();
