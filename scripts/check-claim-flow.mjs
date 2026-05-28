/**
 * ì²?µ¬?±ë¡ ??ê²¬ì ?”ì²­ëª©ë¡/?ìž¬? ì²­ê´€ë¦??°ë™ ê²€ì¦? */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://bbnmxwpacdfqvicybhau.supabase.co",
  "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ",
);

// ê²¬ì ?”ì²­ ëª©ë¡ (quote_requests)
const { data: qr, count: qrCnt } = await sb
  .from("quote_requests").select("id, request_no, status", { count: "exact" })
  .order("id", { ascending: false }).limit(5);
console.log(`[quote_requests] ?„ì²´ ${qrCnt}ê±???ê²¬ì ?”ì²­ ëª©ë¡ ?˜ì´ì§€?ì„œ ì¡°íšŒ??);
for (const r of qr ?? []) console.log(`  #${r.id} ${r.request_no} (${r.status})`);

// ?ìž¬? ì²­ (material_requests) ??request_type ë¶„í¬
console.log("");
const { data: mr } = await sb
  .from("material_requests").select("request_type, status").limit(10000);
const byType = {};
const byStatus = {};
for (const r of mr ?? []) {
  const t = r.request_type ?? "(ë¯¸ì???";
  byType[t] = (byType[t] ?? 0) + 1;
  byStatus[r.status ?? "(ë¯¸ì???"] = (byStatus[r.status ?? "(ë¯¸ì???"] ?? 0) + 1;
}
console.log(`[material_requests] ?„ì²´ ${(mr ?? []).length}ê±????ìž¬? ì²­ ê´€ë¦??˜ì´ì§€?ì„œ ëª¨ë‘ ì¡°íšŒ??);
console.log("  request_type ë¶„í¬:");
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1]))
  console.log(`    ${k.padEnd(15)} ${v}ê±?);
console.log("  status ë¶„í¬:");
for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1]))
  console.log(`    ${k.padEnd(15)} ${v}ê±?);
