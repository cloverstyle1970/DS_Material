// 자재신청 내역 전체 초기화 — Postgres 직접 접속(RLS 우회)
// 1. purchase_order_lines.request_id → NULL
// 2. material_requests 전체 삭제
// 3. Storage 버킷 material-request-photos 비우기 (anon 키로 처리)

import pg from "pg";
import { createClient } from "@supabase/supabase-js";
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

// 사전 집계
const before = await client.query("SELECT COUNT(*)::int AS c FROM public.material_requests");
const beforeLines = await client.query(
  "SELECT COUNT(*)::int AS c FROM public.purchase_order_lines WHERE request_id IS NOT NULL"
);
console.log(`[집계] material_requests ${before.rows[0].c}건, 참조 purchase_order_lines ${beforeLines.rows[0].c}건`);

await client.query("BEGIN");
try {
  // 1. 발주 라인의 request_id 해제
  const r1 = await client.query(
    "UPDATE public.purchase_order_lines SET request_id = NULL WHERE request_id IS NOT NULL"
  );
  console.log(`1) purchase_order_lines.request_id NULL 처리: ${r1.rowCount}건`);

  // 2. material_requests 전체 삭제
  const r2 = await client.query("DELETE FROM public.material_requests");
  console.log(`2) material_requests 삭제: ${r2.rowCount}건`);

  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
}

const after = await client.query("SELECT COUNT(*)::int AS c FROM public.material_requests");
console.log(`   잔여 material_requests: ${after.rows[0].c}건`);

await client.end();

// 3. Storage 버킷 비우기 (storage.objects 는 Postgres DELETE 로 지우면 실제 파일은 남으므로 Storage API 사용)
console.log("3) Storage 'material-request-photos' 파일 삭제...");
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
let total = 0;
async function emptyBucket(prefix = "") {
  const { data, error } = await supabase.storage
    .from("material-request-photos")
    .list(prefix, { limit: 1000 });
  if (error) { console.error(`  list(${prefix}) 실패:`, error.message); return; }
  if (!data || data.length === 0) return;
  const files = [], subdirs = [];
  for (const it of data) {
    const path = prefix ? `${prefix}/${it.name}` : it.name;
    if (it.id === null) subdirs.push(path);
    else files.push(path);
  }
  if (files.length > 0) {
    const { error: rmErr } = await supabase.storage
      .from("material-request-photos").remove(files);
    if (rmErr) console.error(`  remove 실패 (${prefix}):`, rmErr.message);
    else { total += files.length; console.log(`  ${prefix || "/"} 에서 ${files.length}개 삭제`); }
  }
  for (const sub of subdirs) await emptyBucket(sub);
}
await emptyBucket();
console.log(`   총 삭제 파일: ${total}개`);

console.log("\n✅ 자재신청 내역 초기화 완료");
