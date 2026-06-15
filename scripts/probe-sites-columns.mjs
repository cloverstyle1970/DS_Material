import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const candidates = [
  "id", "name", "password", "created_at", "company_type", "contract_type", "contract_date",
  "contract_start", "contract_end", "main_inspector", "sub_inspector", "sub_inspector2",
  "site_phone", "site_mobile", "fax", "manager_phone", "manager_email", "address", "entry_info",
  "vendor", "customer_email", "job_no", "note", "emergency_device"
];

async function run() {
  console.log("Probing columns in 'sites' table...");
  for (const col of candidates) {
    const { error } = await supabase.from("sites").select(col).limit(1);
    if (error) {
      console.log(`❌ Column '${col}' does NOT exist.`);
    } else {
      console.log(`✅ Column '${col}' exists!`);
    }
  }
}
run();
