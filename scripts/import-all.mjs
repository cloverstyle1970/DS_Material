/**
 * vendors, users, sites, elevators ?∞Ïù¥?∞Î? Excel?êÏÑú SupabaseÎ°?import.
 * ?§Ìñâ: node scripts/import-all.mjs
 */
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SUPABASE_URL      = "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function str(v) { return v != null && v !== "" ? String(v).trim() : null; }
function excelDate(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/\D/g, "");
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return null;
}

async function upsert(table, rows, key = "id") {
  const BATCH = 300;
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: key });
    if (error) { console.error(`  ${table} Î∞∞Ïπò ?§Î•ò:`, error.message); }
    else { total += batch.length; process.stdout.write(`\r  ${table}: ${total}/${rows.length}Í±?); }
  }
  console.log(`\r  ${table}: ${total}Í±??ÑÎ£å          `);
}

// ?Ä?Ä 1. vendors ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
console.log("\n[1/4] Í±∞ÎûòÏ≤?import...");
{
  const wb = XLSX.readFile(path.join(ROOT, "Í±∞ÎûòÏ≤òÎ¶¨?§Ìä∏.xlsx"));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const vendors = [];
  let id = 1;
  for (const row of rows.slice(1)) {
    const name = str(row[1]);
    if (!name) continue;
    const rawType = str(row[13]) ?? "Îß§Ï∂ú";
    const type = rawType === "Îß§ÏûÖ/Îß§Ï∂ú" ? "Í≥µÌÜµ" : rawType;
    vendors.push({
      id: id++,
      vendor_code:      str(row[0]),
      name,
      biz_no:           str(row[2]),
      representative:   str(row[3]),
      biz_type:         str(row[5]),
      biz_item:         str(row[6]),
      postal_code:      str(row[7]),
      address:          str(row[8]),
      phone:            str(row[9]),
      fax:              str(row[10]),
      invoice_manager:  str(row[11]),
      invoice_email:    str(row[12]),
      type,
    });
  }
  await upsert("vendors", vendors);
}

// ?Ä?Ä 2. users ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
console.log("\n[2/4] ?¨Ïö©??import...");
{
  const wb = XLSX.readFile(path.join(ROOT, "user.xlsx"));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const users = [];
  for (const row of rows.slice(1)) {
    const name = str(row[1]);
    if (!name) continue;
    const rawId = row[0];
    const id = rawId !== "" ? Number(rawId) : null;
    if (!id) continue;
    users.push({
      id,
      name,
      dept:        str(row[2]),
      rank:        str(row[3]),
      ssn:         str(row[4]),
      cert:        str(row[5]),
      hire_date:   excelDate(row[6]),
      resign_date: excelDate(row[7]),
      phone:       str(row[8]),
      status:      str(row[9]),
      address:     str(row[10]),
      permissions: ["admin"],
    });
  }
  await upsert("users", users);
}

// ?Ä?Ä 3. sites ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
console.log("\n[3/4] ?ÑÏû• import...");
{
  const wb = XLSX.readFile(path.join(ROOT, "?ÑÏû•Î¶¨Ïä§??xlsx"));
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
      company_type:      str(row[1]) === "?êÏÇ¨" ? "DS" : str(row[1]),
      contract_type:     str(row[2]),
      contract_date:     excelDate(row[3]),
      contract_start:    excelDate(row[4]),
      contract_end:      excelDate(row[5]),
      primary_inspector: str(row[6]),
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
  await upsert("sites", sites);
}

// ?Ä?Ä 4. elevators ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
console.log("\n[4/4] ?∏Í∏∞ import...");
{
  const wb = XLSX.readFile(path.join(ROOT, "?ÑÏû•?∏Í∏∞?ïÎ≥¥.xlsx"));
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
  await upsert("elevators", elevators);
}

console.log("\n???ÑÏ≤¥ import ?ÑÎ£å!");
