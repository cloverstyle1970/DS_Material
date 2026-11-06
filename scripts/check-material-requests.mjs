import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter(l => l && !l.startsWith("#"))
    .map(l => l.split("=")).filter(p => p.length >= 2)
    .map(p => [p[0].trim(), p.slice(1).join("=").trim()])
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

console.log("DB URL:", env.NEXT_PUBLIC_SUPABASE_URL);

const { count: total } = await supabase.from("material_requests").select("*", { count: "exact", head: true });
console.log("전체 material_requests count:", total);

const { data: sample } = await supabase.from("material_requests")
  .select("id, request_no, requester_name, site_name, request_type, status, approval_status, requested_at")
  .order("id", { ascending: false })
  .limit(10);
console.log("최근 10건:");
console.log(JSON.stringify(sample, null, 2));

// 구분별 집계
for (const t of ["무상신청", "당직선출고", "유상견적", null]) {
  let q = supabase.from("material_requests").select("*", { count: "exact", head: true });
  if (t === null) q = q.is("request_type", null);
  else q = q.eq("request_type", t);
  const { count } = await q;
  console.log(`  request_type=${t ?? "null"}: ${count}건`);
}
