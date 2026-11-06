import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter(l => l && !l.startsWith("#"))
    .map(l => l.split("=")).filter(p => p.length >= 2)
    .map(p => [p[0].trim(), p.slice(1).join("=").trim()])
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

console.log("DB:", env.NEXT_PUBLIC_SUPABASE_URL);

const tables = [
  "material_requests",
  "quote_requests",
  "quote_request_items",
  "purchase_orders",
  "purchase_order_lines",
];

for (const t of tables) {
  const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
  console.log(`  ${t}: ${error ? `[error: ${error.message}]` : `${count}건`}`);
}

console.log("\n-- quote_requests 샘플 --");
const { data: qrs } = await supabase.from("quote_requests")
  .select("id, quote_request_no, requester_name, site_name, status, requested_at, claim_type")
  .order("id", { ascending: false }).limit(10);
console.log(JSON.stringify(qrs, null, 2));

// quote_requests 의 claim_type 구분별
console.log("\n-- quote_requests claim_type 집계 --");
try {
  const types = ["무상", "유상", "무상자재청구", "유상견적"];
  for (const t of types) {
    const { count } = await supabase.from("quote_requests").select("*", { count: "exact", head: true }).eq("claim_type", t);
    console.log(`  claim_type=${t}: ${count}건`);
  }
} catch (e) { console.log(" claim_type 컬럼 없음:", e.message); }
