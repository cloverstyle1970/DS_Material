/**
 * 청구등록 → 견적요청목록/자재신청관리 연동 검증
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://gwgzzsoknjulwwsmubju.supabase.co",
  "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ",
);

// 견적요청 목록 (quote_requests)
const { data: qr, count: qrCnt } = await sb
  .from("quote_requests").select("id, request_no, status", { count: "exact" })
  .order("id", { ascending: false }).limit(5);
console.log(`[quote_requests] 전체 ${qrCnt}건 — 견적요청 목록 페이지에서 조회됨`);
for (const r of qr ?? []) console.log(`  #${r.id} ${r.request_no} (${r.status})`);

// 자재신청 (material_requests) — request_type 분포
console.log("");
const { data: mr } = await sb
  .from("material_requests").select("request_type, status").limit(10000);
const byType = {};
const byStatus = {};
for (const r of mr ?? []) {
  const t = r.request_type ?? "(미지정)";
  byType[t] = (byType[t] ?? 0) + 1;
  byStatus[r.status ?? "(미지정)"] = (byStatus[r.status ?? "(미지정)"] ?? 0) + 1;
}
console.log(`[material_requests] 전체 ${(mr ?? []).length}건 — 자재신청 관리 페이지에서 모두 조회됨`);
console.log("  request_type 분포:");
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1]))
  console.log(`    ${k.padEnd(15)} ${v}건`);
console.log("  status 분포:");
for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1]))
  console.log(`    ${k.padEnd(15)} ${v}건`);
