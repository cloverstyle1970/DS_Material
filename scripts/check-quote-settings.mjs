import { createClient } from "@supabase/supabase-js";

const SOURCE_URL = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SOURCE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const source = createClient(SOURCE_URL, SOURCE_ANON_KEY);

async function run() {
  const { data: qs } = await source.from("quote_settings").select("*").limit(1);
  if (qs && qs.length > 0) {
    console.log("Source quote_settings columns:", Object.keys(qs[0]));
  }
  const { data: lr } = await source.from("labor_rates").select("*").limit(1);
  if (lr && lr.length > 0) {
    console.log("Source labor_rates columns:", Object.keys(lr[0]));
  }
}
run();
