import { createClient } from "@supabase/supabase-js";

const SOURCE_URL = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SOURCE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const source = createClient(SOURCE_URL, SOURCE_ANON_KEY);

async function inspectTable(tableName) {
  const { data, error } = await source.from(tableName).select("*").limit(1);
  if (error) {
    console.error(`Error fetching source row for ${tableName}:`, error.message);
  } else if (data && data.length > 0) {
    console.log(`Source ${tableName} columns:`, Object.keys(data[0]));
  } else {
    console.log(`No data found in source ${tableName}.`);
  }
}

async function run() {
  await inspectTable("materials");
  await inspectTable("quotes");
  await inspectTable("quote_items");
}
run();
