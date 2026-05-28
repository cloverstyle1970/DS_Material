import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const candidates = [
  "id", "name", "address", "company_type", "contract_type"
];

async function run() {
  console.log("Probing columns in 'managed_sites' table...");
  for (const col of candidates) {
    const { error } = await supabase.from("managed_sites").select(col).limit(1);
    if (error) {
      console.log(`❌ Column '${col}' does NOT exist. (Error: ${error.message})`);
    } else {
      console.log(`✅ Column '${col}' exists!`);
    }
  }
}
run();
