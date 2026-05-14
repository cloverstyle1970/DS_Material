/**
 * 비상통화장치 저장 통합:
 * - elevators.emergency_phone, sites.emergency_device(단수) 값을
 *   sites.emergency_devices(jsonb)로 모으고
 * - 두 컬럼은 NULL 처리.
 *
 * 실행:
 *   npx tsx scripts/site-import/unify_emergency.ts --dry-run
 *   npx tsx scripts/site-import/unify_emergency.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const DRY = process.argv.includes("--dry-run");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(table: string, select = "*"): Promise<any[]> {
  const PAGE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table).select(select).order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function normalize(s: string | null | undefined): string {
  return (s ?? "").replace(/[\s-]/g, "").trim();
}

async function main() {
  const mode = DRY ? "[DRY-RUN]" : "[APPLY]";
  console.log(`${mode} 비상통화장치 통합 시작\n`);

  const sites = await fetchAll("sites");
  const elevs = await fetchAll("elevators");

  // 현장별 elevators 그룹
  const elevsBySite = new Map<string, typeof elevs>();
  for (const e of elevs) {
    const arr = elevsBySite.get(e.site_name) ?? [];
    arr.push(e);
    elevsBySite.set(e.site_name, arr);
  }

  let siteUpdates = 0;
  let elevPhonesCleared = 0;
  let singleAddedCount = 0;
  let elevAddedCount = 0;
  const siteSubmits: { id: number; emergency_devices: unknown; emergency_device: null }[] = [];
  const elevSubmits: number[] = [];

  for (const s of sites) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current: { unit?: string; slot?: number; number: string }[] = Array.isArray(s.emergency_devices) ? s.emergency_devices : [];
    const numSet = new Set(current.map(d => normalize(d.number)));
    const additions: typeof current = [];

    // 1) elevators.emergency_phone 흡수
    const myElevs = elevsBySite.get(s.name) ?? [];
    for (const e of myElevs) {
      const p = e.emergency_phone;
      if (p && !numSet.has(normalize(p))) {
        additions.push({ unit: e.unit_name ?? "", slot: 1, number: p });
        numSet.add(normalize(p));
        elevAddedCount += 1;
      }
      if (p) {
        elevSubmits.push(e.id);
        elevPhonesCleared += 1;
      }
    }

    // 2) sites.emergency_device(단수) 흡수
    const single = s.emergency_device;
    let needSingleClear = false;
    if (single && typeof single === "string") {
      if (!numSet.has(normalize(single))) {
        additions.push({ unit: "", slot: 99, number: single });
        numSet.add(normalize(single));
        singleAddedCount += 1;
      }
      needSingleClear = true;
    }

    if (additions.length > 0 || needSingleClear) {
      siteSubmits.push({
        id: s.id,
        emergency_devices: [...current, ...additions],
        emergency_device: null,
      });
      siteUpdates += 1;
    }
  }

  console.log(`sites 업데이트 대상            : ${siteUpdates}`);
  console.log(`  - elevators.phone 흡수      : ${elevAddedCount}건`);
  console.log(`  - emergency_device 단수 흡수: ${singleAddedCount}건`);
  console.log(`elevators.emergency_phone 비우기: ${elevPhonesCleared}건`);

  if (DRY) {
    // 샘플 5건만 출력
    console.log("\n[샘플 사이트 업데이트 5건]");
    for (const u of siteSubmits.slice(0, 5)) {
      const sname = sites.find(x => x.id === u.id)?.name;
      console.log(`  id=${u.id} ${sname}`);
      console.log(`    emergency_devices=${JSON.stringify(u.emergency_devices)}`);
    }
    console.log("\n[DRY-RUN] 변경 없이 종료");
    return;
  }

  // 적용: sites
  console.log("\n→ sites 업데이트 적용");
  for (let i = 0; i < siteSubmits.length; i += 50) {
    const chunk = siteSubmits.slice(i, i + 50);
    for (const u of chunk) {
      const { error } = await supabase.from("sites")
        .update({ emergency_devices: u.emergency_devices, emergency_device: null })
        .eq("id", u.id);
      if (error) throw new Error(`site ${u.id}: ${error.message}`);
    }
    process.stdout.write(`  ${Math.min(i + 50, siteSubmits.length)}/${siteSubmits.length}\r`);
  }
  console.log("");

  // 적용: elevators.emergency_phone NULL
  if (elevSubmits.length > 0) {
    console.log(`→ elevators.emergency_phone NULL 처리 (${elevSubmits.length}개)`);
    for (let i = 0; i < elevSubmits.length; i += 200) {
      const chunk = elevSubmits.slice(i, i + 200);
      const { error } = await supabase.from("elevators")
        .update({ emergency_phone: null }).in("id", chunk);
      if (error) throw error;
      process.stdout.write(`  ${Math.min(i + 200, elevSubmits.length)}/${elevSubmits.length}\r`);
    }
    console.log("");
  }

  // 시드 JSON 재동기화
  console.log("→ 시드 JSON 재동기화");
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
  console.log("\n✓ 통합 완료");
}

main().catch(e => { console.error("[FATAL]", e); process.exit(1); });
