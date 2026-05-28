/**
 * import ?¨Ïã§???ÑÏ†Å?ºÎ°ú Î∞úÏÉù??sites/elevators Ï§ëÎ≥µ ?ïÎ¶¨.
 * Í∞?Ï§ëÎ≥µ Í∑∏Î£π?êÏÑú min(id) Îß??®Í∏∞Í≥??òÎ®∏ÏßÄ ??†ú.
 *
 * ?§Ìñâ:
 *   npx tsx scripts/site-import/cleanup_duplicates.ts --dry-run
 *   npx tsx scripts/site-import/cleanup_duplicates.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const DRY = process.argv.includes("--dry-run");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(table: string): Promise<any[]> {
  const PAGE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table).select("*").order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  const mode = DRY ? "[DRY-RUN]" : "[APPLY]";
  console.log(`${mode} Ï§ëÎ≥µ ?ïÎ¶¨ ?úÏûë`);

  // sites: name Í∏∞Ï? Í∑∏Î£π
  const sites = await fetchAll("sites");
  const sitesByName: Record<string, number[]> = {};
  for (const s of sites) {
    (sitesByName[s.name] ??= []).push(s.id);
  }
  const siteIdsToDelete: number[] = [];
  for (const [name, ids] of Object.entries(sitesByName)) {
    if (ids.length > 1) {
      ids.sort((a, b) => a - b);
      const keep = ids[0];
      const drop = ids.slice(1);
      console.log(`  sites: ${name}  keep=${keep}  drop=${drop.join(",")}`);
      siteIdsToDelete.push(...drop);
    }
  }

  // elevators: (siteName, unitName) Í∏∞Ï? Í∑∏Î£π
  const elevs = await fetchAll("elevators");
  const elevByKey: Record<string, number[]> = {};
  for (const e of elevs) {
    const key = `${e.site_name}::${e.unit_name ?? ""}`;
    (elevByKey[key] ??= []).push(e.id);
  }
  const elevIdsToDelete: number[] = [];
  for (const [key, ids] of Object.entries(elevByKey)) {
    if (ids.length > 1) {
      ids.sort((a, b) => a - b);
      const keep = ids[0];
      const drop = ids.slice(1);
      console.log(`  elev:  ${key}  keep=${keep}  drop=${drop.join(",")}`);
      elevIdsToDelete.push(...drop);
    }
  }

  console.log(`\nÏ¥???†ú ?Ä?? sites=${siteIdsToDelete.length}, elevators=${elevIdsToDelete.length}`);

  if (DRY) {
    console.log("\n[DRY-RUN] Î≥ÄÍ≤??ÜÏù¥ Ï¢ÖÎ£å.");
    return;
  }

  if (elevIdsToDelete.length > 0) {
    const { error } = await supabase.from("elevators").delete().in("id", elevIdsToDelete);
    if (error) throw error;
    console.log(`elevators ${elevIdsToDelete.length}Í∞???†ú ?ÑÎ£å`);
  }
  if (siteIdsToDelete.length > 0) {
    const { error } = await supabase.from("sites").delete().in("id", siteIdsToDelete);
    if (error) throw error;
    console.log(`sites ${siteIdsToDelete.length}Í∞???†ú ?ÑÎ£å`);
  }

  // ?úÎìú JSON ?¨ÎèôÍ∏∞Ìôî
  console.log("\n???úÎìú JSON ?¨Ï°∞?å¬∑ÎèôÍ∏∞Ìôî");
  const dbSites = await fetchAll("sites");
  const dbElevs = await fetchAll("elevators");
  const seedSites = dbSites.map(r => ({
    id: r.id, name: r.name,
    companyType: r.company_type ?? null, contractType: r.contract_type ?? null,
    contractDate: r.contract_date ?? null, contractStart: r.contract_start ?? null,
    contractEnd: r.contract_end ?? null,
    primaryInspector: r.primary_inspector ?? null,
    subInspector: r.sub_inspector ?? null, subInspector2: r.sub_inspector2 ?? null,
    sitePhone: r.site_phone ?? null, siteMobile: r.site_mobile ?? null,
    fax: r.fax ?? null, managerPhone: r.manager_phone ?? null,
    managerEmail: r.manager_email ?? null, address: r.address ?? null,
    entryInfo: r.entry_info ?? null, vendor: r.vendor ?? null,
    customerEmail: r.customer_email ?? null, jobNo: r.job_no ?? null,
    note: r.note ?? null,
    emergencyDevice: r.emergency_device ?? null,
    emergencyDevices: r.emergency_devices ?? [],
    warrantyCount: r.warranty_count ?? null, warrantyUnits: r.warranty_units ?? null,
    warrantyStart: r.warranty_start ?? null, warrantyEnd: r.warranty_end ?? null,
    alias: r.alias ?? null, ledgerNo: r.ledger_no ?? null, siteKind: r.site_kind ?? null,
  }));
  const seedElevs = dbElevs.map(r => ({
    id: r.id, siteName: r.site_name ?? "",
    unitName: r.unit_name ?? null, elevatorNo: r.elevator_no ?? null,
    emergencyPhone: r.emergency_phone ?? null, modelName: r.model_name ?? null,
  }));
  writeFileSync(resolve(process.cwd(), "src/data/sites.json"),     JSON.stringify(seedSites, null, 2), "utf-8");
  writeFileSync(resolve(process.cwd(), "src/data/elevators.json"), JSON.stringify(seedElevs, null, 2), "utf-8");
  console.log(`  sites.json     : ${seedSites.length}Í∞?);
  console.log(`  elevators.json : ${seedElevs.length}Í∞?);
  console.log("\n???ïÎ¶¨ ?ÑÎ£å");
}

main().catch(e => { console.error("[FATAL]", e); process.exit(1); });
