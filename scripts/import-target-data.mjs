import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env.local") });

const SOURCE_URL = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SOURCE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const source = createClient(SOURCE_URL, SOURCE_ANON_KEY);

const TARGET_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const TARGET_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const target = createClient(TARGET_URL, TARGET_ANON_KEY);

function str(v) { return v != null && v !== "" ? String(v).trim() : null; }
function excelDate(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/\D/g, "");
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return null;
}

async function upsert(table, rows, key = "id") {
  const BATCH = 100;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await target.from(table).upsert(batch, { onConflict: key });
    if (error) {
      console.error(`❌ [${table}] Batch insertion failed:`, error.message);
      return false;
    } else {
      total += batch.length;
      console.log(`  ➔ ${table}: ${total}/${rows.length} rows synced...`);
    }
  }
  console.log(`✅ [${table}] Successfully synced ${total} rows.`);
  return true;
}

async function importSites() {
  console.log("\n[1/3] Importing Sites from Excel...");
  const wb = XLSX.readFile(path.join(ROOT, "현장리스트.xlsx"));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const seen = new Set();
  const sites = [];
  let id = 1;
  for (const row of rows.slice(1)) {
    const name = str(row[0]);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    sites.push({
      id: id++,
      name,
      company_type:      str(row[1]) === "지사" ? "DS" : str(row[1]),
      contract_type:     str(row[2]),
      contract_date:     excelDate(row[3]),
      contract_start:    excelDate(row[4]),
      contract_end:      excelDate(row[5]),
      main_inspector:    str(row[6]),
      sub_inspector:     str(row[7]),
      sub_inspector2:    str(row[8]),
      site_phone:        str(row[9]),
      site_mobile:       str(row[10]),
      fax:               str(row[12]),
      manager_phone:     str(row[13]),
      manager_email:     str(row[14]),
      address:           str(row[15]),
      entry_info:        str(row[16]),
      vendor:            str(row[17]),
      customer_email:    str(row[20]),
      job_no:            str(row[23]),
      note:              str(row[24]),
      emergency_device:  str(row[25]),
      emergency_devices: [],
    });
  }
  return await upsert("sites", sites);
}

async function importElevators() {
  console.log("\n[2/3] Importing Elevators from Excel...");
  const wb = XLSX.readFile(path.join(ROOT, "현장호기정보.xlsx"));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const elevators = [];
  let id = 1;
  for (const row of rows.slice(1)) {
    const siteName = str(row[0]);
    if (!siteName) continue;
    elevators.push({
      id: id++,
      site_name:   siteName,
      unit_name:   str(row[1]),
      elevator_no: str(row[2]),
    });
  }
  return await upsert("elevators", elevators);
}

async function migrateTable(tableName, idColumn) {
  console.log(`\n[3/3] Migrating [${tableName}] table from source DB...`);
  let rows = [];
  let start = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: chunk, error: fetchError } = await source
      .from(tableName)
      .select("*")
      .range(start, start + pageSize - 1);

    if (fetchError) {
      console.error(`❌ [${tableName}] Fetch failed:`, fetchError.message);
      return false;
    }

    if (!chunk || chunk.length === 0) {
      hasMore = false;
    } else {
      rows.push(...chunk);
      if (chunk.length < pageSize) {
        hasMore = false;
      } else {
        start += pageSize;
      }
    }
  }

  if (rows.length === 0) {
    console.log(`ℹ️ [${tableName}] No data to migrate.`);
    return true;
  }

  return await upsert(tableName, rows, idColumn);
}

async function run() {
  const sSuccess = await importSites();
  if (!sSuccess) {
    console.error("❌ Sites import failed. Aborting.");
    return;
  }
  const eSuccess = await importElevators();
  if (!eSuccess) {
    console.error("❌ Elevators import failed. Aborting.");
    return;
  }

  const tables = [
    { name: "materials", idCol: "id" },
    { name: "quote_settings", idCol: "id" },
    { name: "labor_rates", idCol: "id" },
    { name: "quotes", idCol: "id" },
    { name: "quote_items", idCol: "id" }
  ];

  for (const table of tables) {
    const success = await migrateTable(table.name, table.idCol);
    if (!success) {
      console.error(`❌ Migration failed for table: ${table.name}`);
      console.log("\n💡 IMPORTANT: If you see RLS policy errors, please temporarily run this SQL in your Supabase SQL Editor:");
      console.log(`   ALTER TABLE public.${table.name} DISABLE ROW LEVEL SECURITY;`);
      console.log("\n   And then run the script again. Don't forget to re-enable it afterwards:");
      console.log(`   ALTER TABLE public.${table.name} ENABLE ROW LEVEL SECURITY;`);
      break;
    }
  }
}

run();
