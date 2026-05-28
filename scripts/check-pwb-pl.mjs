/**
 * 'PWB-PL' ?ˆëª… ?ì¬ ì¡°íšŒ ??ê·œê²© ???ˆëª… ì¹˜í™˜ ?¬ì „ ?ê?
 * ?¤í–‰: node scripts/check-pwb-pl.mjs
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { data, error } = await sb
  .from("materials")
  .select("id, name, alias, model_no, stock_qty")
  .eq("name", "PWB-PL")
  .order("id");

if (error) { console.error("ERR:", error); process.exit(1); }

console.log(`ì´?${data.length}ê±?);
console.log("");
console.log("id".padEnd(14) + "| name".padEnd(14) + "| model_no(ê·œê²©)".padEnd(34) + "| alias".padEnd(20) + "| stock");
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

// ë¹?model_no / null model_no ì¹´ìš´????ì¹˜í™˜ ???ˆëª…??ë¹?ê°’ì´ ?˜ëŠ” ?„í—˜ ?¼ì¸
const emptyModel = data.filter(r => !r.model_no || !String(r.model_no).trim());
if (emptyModel.length > 0) {
  console.log("");
  console.log(`[!] ê·œê²©(model_no)??ë¹„ì–´?ˆëŠ” ?? ${emptyModel.length}ê±?);
  console.log("    ?????‰ë“¤?€ ì¹˜í™˜?˜ë©´ ?ˆëª…??ë¹„ê²Œ ?©ë‹ˆ?? UPDATE ?€?ì—???œì™¸ ê¶Œì¥.");
  for (const r of emptyModel) console.log(`    - ${r.id}`);
}

// ?™ì¼ model_no ì¤‘ë³µ (ì¹˜í™˜ ??name ì¤‘ë³µ ë°œìƒ ?¬ë?)
const byModel = new Map();
for (const r of data) {
  const k = String(r.model_no ?? "").trim();
  if (!k) continue;
  byModel.set(k, (byModel.get(k) ?? 0) + 1);
}
const dupModel = [...byModel.entries()].filter(([, c]) => c > 1);
if (dupModel.length > 0) {
  console.log("");
  console.log(`[!] ?™ì¼ model_no ì¤‘ë³µ: ${dupModel.length}ì¢?);
  for (const [k, c] of dupModel) console.log(`    - "${k}" x ${c}ê±?);
} else {
  console.log("");
  console.log("[OK] model_no ì¤‘ë³µ ?†ìŒ");
}
