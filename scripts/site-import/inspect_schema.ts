/**
 * 현재 Supabase의 sites / elevators 테이블 실제 구조와 데이터 샘플 조회.
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function main() {
  const { data: sites, error: e1 } = await supabase
    .from("sites").select("*").eq("name", "B1삼송동빌딩").limit(1);
  if (e1) throw e1;
  console.log("\n=== sites 한 행 (B1삼송동빌딩) ===");
  console.log(JSON.stringify(sites?.[0], null, 2));

  const { data: elevs, error: e2 } = await supabase
    .from("elevators").select("*").eq("site_name", "B1삼송동빌딩");
  if (e2) throw e2;
  console.log("\n=== elevators (B1삼송동빌딩) ===");
  console.log(JSON.stringify(elevs, null, 2));

  // 비상통화장치가 jsonb로 들어간 다른 사이트 샘플
  const { data: epSample } = await supabase
    .from("sites").select("name, emergency_device, emergency_devices")
    .not("emergency_devices", "is", null).limit(3);
  console.log("\n=== emergency_devices 샘플 3건 ===");
  for (const r of epSample ?? []) {
    console.log(`${r.name}:`);
    console.log(`  emergency_device  = ${JSON.stringify(r.emergency_device)}`);
    console.log(`  emergency_devices = ${JSON.stringify(r.emergency_devices)}`);
  }

  // 총 카운트
  const { count: sc } = await supabase.from("sites").select("*", { count: "exact", head: true });
  const { count: ec } = await supabase.from("elevators").select("*", { count: "exact", head: true });
  console.log(`\n총 sites    : ${sc}`);
  console.log(`총 elevators: ${ec}`);
}

main().catch(e => { console.error(e); process.exit(1); });
