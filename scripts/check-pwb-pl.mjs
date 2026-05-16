/**
 * 'PWB-PL' 품명 자재 조회 — 규격 → 품명 치환 사전 점검
 * 실행: node scripts/check-pwb-pl.mjs
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { data, error } = await sb
  .from("materials")
  .select("id, name, alias, model_no, stock_qty")
  .eq("name", "PWB-PL")
  .order("id");

if (error) { console.error("ERR:", error); process.exit(1); }

console.log(`총 ${data.length}건`);
console.log("");
console.log("id".padEnd(14) + "| name".padEnd(14) + "| model_no(규격)".padEnd(34) + "| alias".padEnd(20) + "| stock");
console.log("-".repeat(95));
for (const r of data) {
  console.log(
    String(r.id ?? "").padEnd(13) + " | " +
    String(r.name ?? "").padEnd(11) + " | " +
    String(r.model_no ?? "").padEnd(30) + " | " +
    String(r.alias ?? "").padEnd(17) + " | " +
    String(r.stock_qty ?? 0)
  );
}

// 빈 model_no / null model_no 카운트 — 치환 시 품명이 빈 값이 되는 위험 라인
const emptyModel = data.filter(r => !r.model_no || !String(r.model_no).trim());
if (emptyModel.length > 0) {
  console.log("");
  console.log(`[!] 규격(model_no)이 비어있는 행: ${emptyModel.length}건`);
  console.log("    → 이 행들은 치환하면 품명이 비게 됩니다. UPDATE 대상에서 제외 권장.");
  for (const r of emptyModel) console.log(`    - ${r.id}`);
}

// 동일 model_no 중복 (치환 후 name 중복 발생 여부)
const byModel = new Map();
for (const r of data) {
  const k = String(r.model_no ?? "").trim();
  if (!k) continue;
  byModel.set(k, (byModel.get(k) ?? 0) + 1);
}
const dupModel = [...byModel.entries()].filter(([, c]) => c > 1);
if (dupModel.length > 0) {
  console.log("");
  console.log(`[!] 동일 model_no 중복: ${dupModel.length}종`);
  for (const [k, c] of dupModel) console.log(`    - "${k}" x ${c}건`);
} else {
  console.log("");
  console.log("[OK] model_no 중복 없음");
}
