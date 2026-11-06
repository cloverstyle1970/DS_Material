// 자재신청 내역 전체 초기화 스크립트
// 1. purchase_orders.request_id → NULL (외래 참조 해제)
// 2. material_requests 전체 삭제
// 3. Storage 버킷 "material-request-photos" 안의 파일 전체 삭제

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("="))
    .filter((p) => p.length >= 2)
    .map((p) => [p[0].trim(), p.slice(1).join("=").trim()])
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error(".env.local 에 SUPABASE URL/KEY 없음");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 0. 사전 집계
const { count: beforeReq } = await supabase
  .from("material_requests")
  .select("*", { count: "exact", head: true });
const { count: linkedOrders } = await supabase
  .from("purchase_order_lines")
  .select("*", { count: "exact", head: true })
  .not("request_id", "is", null);
console.log(`[집계] material_requests ${beforeReq}건, 참조 purchase_order_lines ${linkedOrders}건`);

// 1. 발주 라인의 request_id → NULL
console.log("1) purchase_order_lines.request_id 를 NULL 로...");
const { error: nullErr } = await supabase
  .from("purchase_order_lines")
  .update({ request_id: null })
  .not("request_id", "is", null);
if (nullErr) console.error("  경고:", nullErr.message);
else console.log("  완료");

// 2. material_requests 전체 삭제
console.log("2) material_requests 전체 삭제...");
const { error: delErr } = await supabase
  .from("material_requests")
  .delete()
  .not("id", "is", null);
if (delErr) throw new Error("삭제 실패: " + delErr.message);
const { count: afterReq } = await supabase
  .from("material_requests")
  .select("*", { count: "exact", head: true });
console.log(`  완료. 남은 행: ${afterReq}`);

// 3. Storage 버킷 비우기
console.log("3) Storage 버킷 'material-request-photos' 파일 삭제...");
let totalRemoved = 0;
async function emptyBucket(prefix = "") {
  const { data, error } = await supabase.storage
    .from("material-request-photos")
    .list(prefix, { limit: 1000 });
  if (error) {
    console.error(`  list(${prefix}) 실패:`, error.message);
    return;
  }
  if (!data || data.length === 0) return;
  const files = [];
  const subdirs = [];
  for (const item of data) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) subdirs.push(path);
    else files.push(path);
  }
  if (files.length > 0) {
    const { error: rmErr } = await supabase.storage
      .from("material-request-photos")
      .remove(files);
    if (rmErr) console.error(`  remove 실패 (${prefix}):`, rmErr.message);
    else {
      totalRemoved += files.length;
      console.log(`  ${prefix || "/"} 에서 ${files.length}개 파일 삭제`);
    }
  }
  for (const sub of subdirs) await emptyBucket(sub);
}
await emptyBucket();
console.log(`  총 삭제 파일: ${totalRemoved}개`);

console.log("\n✅ 자재신청 내역 초기화 완료");
