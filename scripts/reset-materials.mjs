import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL     = "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const partList = JSON.parse(
  readFileSync(join(__dirname, "../src/data/part-list.json"), "utf-8")
);

function toDb(d) {
  return {
    id:            d.id,
    category_code: d.categoryCode ?? "",
    name:          d.name,
    alias:         d.alias       ?? null,
    model_no:      d.modelNo     ?? null,
    unit:          d.unit        ?? null,
    buy_price:     d.buyPrice    ?? null,
    sell_price:    d.sellPrice   ?? null,
    storage_loc:   d.storageLoc  ?? null,
    stock_qty:     d.stockQty    ?? 0,
    is_repair:     d.isRepair    ?? false,
    e_count_cd:    d.eCountCd    ?? null,
    created_at:    d.createdAt,
  };
}

const rows = partList.map(toDb);

console.log("Í∏∞Ï°¥ materials ?????ïÏù∏...");
const { count: beforeCount, error: countErr } = await supabase
  .from("materials").select("*", { count: "exact", head: true });
if (countErr) {
  console.error("Ï°∞Ìöå ?§Ìå®:", countErr.message);
  process.exit(1);
}
console.log(`?ÑÏû¨ ${beforeCount}Í±?Ï°¥Ïû¨. ?ÑÏ≤¥ ??†ú ÏßÑÌñâ...`);

const { error: delErr } = await supabase
  .from("materials").delete().neq("id", "__never_match__");
if (delErr) {
  console.error("??†ú ?§Ìå®:", delErr.message);
  process.exit(1);
}
console.log("??†ú ?ÑÎ£å.");

console.log(`${rows.length}Í±?insert ?úÏûë...`);
const BATCH = 500;
let errors = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const { error } = await supabase.from("materials").insert(batch);
  const batchNo = Math.floor(i / BATCH) + 1;
  const total   = Math.ceil(rows.length / BATCH);
  if (error) {
    console.error(`  Î∞∞Ïπò ${batchNo}/${total} ?§Î•ò: ${error.message}`);
    errors++;
  } else {
    console.log(`  Î∞∞Ïπò ${batchNo}/${total} ?ÑÎ£å (${Math.min(i + BATCH, rows.length)}/${rows.length}Í±?`);
  }
}

const { count: afterCount } = await supabase
  .from("materials").select("*", { count: "exact", head: true });
console.log(`\nÏµúÏ¢Ö materials ???? ${afterCount}Í±?);
if (errors === 0) console.log("??Ï¥àÍ∏∞???¨ÏÇΩ???ÑÎ£å");
else console.log(`?ÑÎ£å (?§Î•ò ${errors}Î∞∞Ïπò)`);
