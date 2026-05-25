import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function str(v) { return v != null && v !== "" ? String(v).trim() : null; }
function excelDate(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/\D/g, "");
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return null;
}

async function main() {
  // 1. Fetch from Database
  const { data: dbUsers, error } = await supabase
    .from("users")
    .select("*");
    
  if (error) {
    console.error("Error fetching db users:", error.message);
    process.exit(1);
  }
  
  const dbMap = new Map(dbUsers.map(u => [u.id, u]));

  // 2. Fetch from Excel
  const filePath = path.join(__dirname, "..", "ds-page", "user.xlsx");
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const excelRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  
  const excelUsers = [];
  for (const row of excelRows.slice(1)) {
    const name = str(row[1]);
    if (!name) continue;
    const rawId = row[0];
    const id = rawId !== "" ? Number(rawId) : null;
    if (!id) continue;
    
    excelUsers.push({
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
    });
  }
  
  const excelMap = new Map(excelUsers.map(u => [u.id, u]));

  // 3. Comparison
  const newUsers = [];
  const updatedUsers = [];
  const unmatchedDbUsers = []; // in db, but not in excel
  
  // Check excel against db
  for (const exUser of excelUsers) {
    const dbUser = dbMap.get(exUser.id);
    if (!dbUser) {
      newUsers.push(exUser);
    } else {
      // Compare fields
      const changes = {};
      const fields = ['name', 'dept', 'rank', 'ssn', 'cert', 'hire_date', 'resign_date', 'phone', 'status', 'address'];
      for (const field of fields) {
        let dbVal = dbUser[field];
        let exVal = exUser[field];
        
        // Normalize for comparison
        if (dbVal === null) dbVal = "";
        if (exVal === null) exVal = "";
        
        if (String(dbVal).trim() !== String(exVal).trim()) {
          changes[field] = { db: dbUser[field], excel: exUser[field] };
        }
      }
      
      if (Object.keys(changes).length > 0) {
        updatedUsers.push({
          id: exUser.id,
          name: exUser.name,
          changes
        });
      }
    }
  }
  
  // Check db against excel
  for (const dbUser of dbUsers) {
    if (!excelMap.has(dbUser.id)) {
      unmatchedDbUsers.push(dbUser);
    }
  }
  
  console.log(`=== COMPARISON RESULTS ===`);
  console.log(`Total DB Users: ${dbUsers.length}`);
  console.log(`Total Excel Users: ${excelUsers.length}`);
  console.log(`\n1. New Users to ADD (${newUsers.length}):`);
  newUsers.forEach(u => {
    console.log(`   - ID ${u.id}: ${u.name} (${u.dept} / ${u.rank}) - Phone: ${u.phone}, Status: ${u.status}`);
  });
  
  console.log(`\n2. Users to UPDATE (${updatedUsers.length}):`);
  updatedUsers.forEach(u => {
    console.log(`   - ID ${u.id} (${u.name}):`);
    for (const [field, val] of Object.entries(u.changes)) {
      console.log(`     * ${field}: "${val.db}" -> "${val.excel}"`);
    }
  });
  
  console.log(`\n3. Users in DB but NOT in Excel (${unmatchedDbUsers.length}):`);
  unmatchedDbUsers.forEach(u => {
    console.log(`   - ID ${u.id}: ${u.name} (${u.dept} / ${u.rank}) - Status: ${u.status}`);
  });
}

main();
