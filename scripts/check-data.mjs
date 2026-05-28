import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  console.log("Checking data counts...");

  const { count: matCount, error: matErr } = await supabase
    .from("materials")
    .select("*", { count: "exact", head: true });

  console.log("materials table count:", matCount, "error:", matErr?.message);

  const { count: siteCount, error: siteErr } = await supabase
    .from("sites")
    .select("*", { count: "exact", head: true });

  console.log("sites table/view count:", siteCount, "error:", siteErr?.message);

  const { count: managedSiteCount, error: managedSiteErr } = await supabase
    .from("managed_sites")
    .select("*", { count: "exact", head: true });

  console.log("managed_sites table count:", managedSiteCount, "error:", managedSiteErr?.message);

  // Let's print 1 sample from each if count > 0
  if (matCount > 0) {
    const { data } = await supabase.from("materials").select("*").limit(1);
    console.log("Sample material:", data);
  }
  if (siteCount > 0) {
    const { data } = await supabase.from("sites").select("*").limit(1);
    console.log("Sample site:", data);
  }
}
run();
