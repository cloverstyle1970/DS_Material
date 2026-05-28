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
const BATCH = 500;

console.log(`ì´?${rows.length}ê±?import ?œìž‘...`);

let errors = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const { error } = await supabase.from("materials").upsert(batch, { onConflict: "id" });
  const batchNo = Math.floor(i / BATCH) + 1;
  const total   = Math.ceil(rows.length / BATCH);
  if (error) {
    console.error(`  ë°°ì¹˜ ${batchNo}/${total} ?¤ë¥˜: ${error.message}`);
    errors++;
  } else {
    console.log(`  ë°°ì¹˜ ${batchNo}/${total} ?„ë£Œ (${Math.min(i + BATCH, rows.length)}/${rows.length}ê±?`);
  }
}

if (errors === 0) console.log("\n??ëª¨ë“  ?ìž¬ import ?„ë£Œ!");
else console.log(`\n?„ë£Œ (?¤ë¥˜ ${errors}ë°°ì¹˜)`);
