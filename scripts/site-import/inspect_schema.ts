/**
 * ?„ìž¬ Supabase??sites / elevators ?Œì´ë¸??¤ì œ êµ¬ì¡°?€ ?°ì´???˜í”Œ ì¡°íšŒ.
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
    .from("sites").select("*").eq("name", "B1?¼ì†¡?™ë¹Œ??).limit(1);
  if (e1) throw e1;
  console.log("\n=== sites ????(B1?¼ì†¡?™ë¹Œ?? ===");
  console.log(JSON.stringify(sites?.[0], null, 2));

  const { data: elevs, error: e2 } = await supabase
    .from("elevators").select("*").eq("site_name", "B1?¼ì†¡?™ë¹Œ??);
  if (e2) throw e2;
  console.log("\n=== elevators (B1?¼ì†¡?™ë¹Œ?? ===");
  console.log(JSON.stringify(elevs, null, 2));

  // ë¹„ìƒ?µí™”?¥ì¹˜ê°€ jsonbë¡??¤ì–´ê°??¤ë¥¸ ?¬ì´???˜í”Œ
  const { data: epSample } = await supabase
    .from("sites").select("name, emergency_device, emergency_devices")
    .not("emergency_devices", "is", null).limit(3);
  console.log("\n=== emergency_devices ?˜í”Œ 3ê±?===");
  for (const r of epSample ?? []) {
    console.log(`${r.name}:`);
    console.log(`  emergency_device  = ${JSON.stringify(r.emergency_device)}`);
    console.log(`  emergency_devices = ${JSON.stringify(r.emergency_devices)}`);
  }

  // ì´?ì¹´ìš´??  const { count: sc } = await supabase.from("sites").select("*", { count: "exact", head: true });
  const { count: ec } = await supabase.from("elevators").select("*", { count: "exact", head: true });
  console.log(`\nì´?sites    : ${sc}`);
  console.log(`ì´?elevators: ${ec}`);
}

main().catch(e => { console.error(e); process.exit(1); });
