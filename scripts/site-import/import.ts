/**
 * 2026-05-13 ?�합 ?��? import ?�크립트.
 *
 * ?�행:
 *   npx tsx scripts/site-import/import.ts --dry-run   # 변경사??�� 출력, ?�제 ?�기 ?�음
 *   npx tsx scripts/site-import/import.ts             # ?�제 ?�용 (--apply ?� ?�일)
 *
 * ?�전 조건:
 *   1) supabase/sites_elevators_extend.sql ??Supabase Dashboard ?�서 ?�행?�여 컬럼 ?�장
 *   2) scripts/site-import/convert.py �??�행?�여 import-payload.json ?�성
 *   3) .env.local ??NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (?�는 SUPABASE_SERVICE_ROLE_KEY)
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const DRY = process.argv.includes("--dry-run");
const ROOT = process.cwd();
const PAYLOAD_PATH = resolve(ROOT, "scripts/site-import/import-payload.json");
const SITES_JSON   = resolve(ROOT, "src/data/sites.json");
const ELEVS_JSON   = resolve(ROOT, "src/data/elevators.json");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[ERR] NEXT_PUBLIC_SUPABASE_URL / KEY 가 .env.local ???�습?�다.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface SitePayload {
  id?: number;
  name: string;
  alias: string | null;
  ledgerNo: string | null;
  jobNo: string | null;
  companyType: string | null;
  siteKind: string | null;
  contractType: string | null;
  contractDate: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  warrantyEnd: string | null;
  primaryInspector: string | null;
  subInspector: string | null;
  subInspector2: string | null;
  sitePhone: string | null;
  siteMobile: string | null;
  fax: string | null;
  managerEmail: string | null;
  address: string | null;
  note: string | null;
  vendor: string | null;
  emergencyDevices: { unit: string; slot: number; number: string }[];
}

interface ElevatorPayload {
  id?: number;
  siteName: string;
  unitName: string | null;
  elevatorNo: string | null;
  modelName: string | null;
}

interface Payload {
  sites: SitePayload[];
  elevators: ElevatorPayload[];
  renameMap: Record<string, string>;
  sitesToDelete: string[];
  elevatorsToDelete: number[];
  placeholderElevatorIds: number[];
}

function siteToDb(s: SitePayload) {
  return {
    ...(s.id !== undefined ? { id: s.id } : {}),
    name:               s.name,
    alias:              s.alias,
    ledger_no:          s.ledgerNo,
    job_no:             s.jobNo,
    company_type:       s.companyType,
    site_kind:          s.siteKind,
    contract_type:      s.contractType,
    contract_date:      s.contractDate,
    contract_start:     s.contractStart,
    contract_end:       s.contractEnd,
    warranty_end:       s.warrantyEnd,
    main_inspector:     s.primaryInspector,
    sub_inspector:      s.subInspector,
    sub_inspector2:     s.subInspector2,
    site_phone:         s.sitePhone,
    site_mobile:        s.siteMobile,
    fax:                s.fax,
    manager_email:      s.managerEmail,
    address:            s.address,
    note:               s.note,
    vendor:             s.vendor,
    emergency_devices:  s.emergencyDevices,
  };
}

function elevatorToDb(e: ElevatorPayload) {
  return {
    ...(e.id !== undefined ? { id: e.id } : {}),
    site_name:   e.siteName,
    unit_name:   e.unitName,
    elevator_no: e.elevatorNo,
    model_name:  e.modelName,
  };
}

async function main() {
  const payload: Payload = JSON.parse(readFileSync(PAYLOAD_PATH, "utf-8"));
  const mode = DRY ? "[DRY-RUN]" : "[APPLY]";

  console.log(`${mode} Import ?�작`);
  console.log(`  sites          : ${payload.sites.length} (new=${payload.sites.filter(s=>!s.id).length})`);
  console.log(`  elevators      : ${payload.elevators.length} (new=${payload.elevators.filter(e=>!e.id).length})`);
  console.log(`  rename         : ${Object.keys(payload.renameMap).length}`);
  console.log(`  sitesToDelete  : ${payload.sitesToDelete.length}`);
  console.log(`  elevs delete   : ${payload.elevatorsToDelete.length + payload.placeholderElevatorIds.length}`);

  if (DRY) {
    console.log("\n[DRY-RUN] Supabase 변�??�이 종료. ?�제 ?�용?� ?�자 ?�이 ?�행?�세??");
    return;
  }

  // 1) placeholder + orphan elevators ??�� (FK 충돌 방�?)
  const elevIdsToDelete = [
    ...payload.elevatorsToDelete,
    ...payload.placeholderElevatorIds,
  ];
  if (elevIdsToDelete.length > 0) {
    console.log(`\n??elevators ??�� (${elevIdsToDelete.length}�?`);
    const { error } = await supabase.from("elevators").delete().in("id", elevIdsToDelete);
    if (error) throw new Error(`elevators delete: ${error.message}`);
  }

  // 2) orphan sites ??��
  if (payload.sitesToDelete.length > 0) {
    console.log(`??sites ??�� (${payload.sitesToDelete.length}�?`);
    const { error } = await supabase.from("sites").delete().in("name", payload.sitesToDelete);
    if (error) throw new Error(`sites delete: ${error.message}`);
  }

  // 3) sites: id ?�는 ?��? update, id ?�는 ?��? insert
  const sitesUpdate = payload.sites.filter(s => s.id !== undefined).map(siteToDb);
  const sitesInsert = payload.sites.filter(s => s.id === undefined).map(siteToDb);
  console.log(`??sites update (${sitesUpdate.length}�?`);
  for (let i = 0; i < sitesUpdate.length; i += 100) {
    const chunk = sitesUpdate.slice(i, i + 100);
    const { error } = await supabase.from("sites").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`sites update (batch ${i}): ${error.message}`);
    process.stdout.write(`  ${Math.min(i + 100, sitesUpdate.length)}/${sitesUpdate.length}\r`);
  }
  console.log("");
  if (sitesInsert.length > 0) {
    console.log(`??sites insert new (${sitesInsert.length}�?`);
    const { error } = await supabase.from("sites").insert(sitesInsert);
    if (error) throw new Error(`sites insert: ${error.message}`);
  }

  // 4) elevators: id ?�는 ?��? update, id ?�는 ?��? insert
  const elevsUpdate = payload.elevators.filter(e => e.id !== undefined).map(elevatorToDb);
  const elevsInsert = payload.elevators.filter(e => e.id === undefined).map(elevatorToDb);
  console.log(`??elevators update (${elevsUpdate.length}�?`);
  for (let i = 0; i < elevsUpdate.length; i += 200) {
    const chunk = elevsUpdate.slice(i, i + 200);
    const { error } = await supabase.from("elevators").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`elevators update (batch ${i}): ${error.message}`);
    process.stdout.write(`  ${Math.min(i + 200, elevsUpdate.length)}/${elevsUpdate.length}\r`);
  }
  console.log("");
  if (elevsInsert.length > 0) {
    console.log(`??elevators insert new (${elevsInsert.length}�?`);
    const { error } = await supabase.from("elevators").insert(elevsInsert);
    if (error) throw new Error(`elevators insert: ${error.message}`);
  }

  // 5) src/data/*.json ?�기??(?�드 ?�일)
  console.log("???�드 JSON ?�조?�·동기화");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAll(table: string): Promise<any[]> {
    const PAGE = 1000;
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
  const dbSites = await fetchAll("sites");
  const dbElevs = await fetchAll("elevators");

  const seedSites = (dbSites ?? []).map(r => ({
    id:                r.id,
    name:              r.name,
    companyType:       r.company_type ?? null,
    contractType:      r.contract_type ?? null,
    contractDate:      r.contract_date ?? null,
    contractStart:     r.contract_start ?? null,
    contractEnd:       r.contract_end ?? null,
    primaryInspector:  r.main_inspector ?? null,
    subInspector:      r.sub_inspector ?? null,
    subInspector2:     r.sub_inspector2 ?? null,
    sitePhone:         r.site_phone ?? null,
    siteMobile:        r.site_mobile ?? null,
    fax:               r.fax ?? null,
    managerPhone:      r.manager_phone ?? null,
    managerEmail:      r.manager_email ?? null,
    address:           r.address ?? null,
    entryInfo:         r.entry_info ?? null,
    vendor:            r.vendor ?? null,
    customerEmail:     r.customer_email ?? null,
    jobNo:             r.job_no ?? null,
    note:              r.note ?? null,
    emergencyDevice:   r.emergency_device ?? null,
    emergencyDevices:  r.emergency_devices ?? [],
    warrantyCount:     r.warranty_count ?? null,
    warrantyUnits:     r.warranty_units ?? null,
    warrantyStart:     r.warranty_start ?? null,
    warrantyEnd:       r.warranty_end ?? null,
    alias:             r.alias ?? null,
    ledgerNo:          r.ledger_no ?? null,
    siteKind:          r.site_kind ?? null,
  }));
  const seedElevs = (dbElevs ?? []).map(r => ({
    id:             r.id,
    siteName:       r.site_name ?? "",
    unitName:       r.unit_name ?? null,
    elevatorNo:     r.elevator_no ?? null,
    emergencyPhone: r.emergency_phone ?? null,
    modelName:      r.model_name ?? null,
  }));

  writeFileSync(SITES_JSON, JSON.stringify(seedSites, null, 2), "utf-8");
  writeFileSync(ELEVS_JSON, JSON.stringify(seedElevs, null, 2), "utf-8");
  console.log(`  sites.json     : ${seedSites.length}�?);
  console.log(`  elevators.json : ${seedElevs.length}�?);

  console.log("\n??Import ?�료");
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
