import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL     = "https://gwgzzsoknjulwwsmubju.supabase.co";
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

console.log("기존 materials 행 수 확인...");
const { count: beforeCount, error: countErr } = await supabase
  .from("materials").select("*", { count: "exact", head: true });
if (countErr) {
  console.error("조회 실패:", countErr.message);
  process.exit(1);
}
console.log(`현재 ${beforeCount}건 존재. 전체 삭제 진행...`);

const { error: delErr } = await supabase
  .from("materials").delete().neq("id", "__never_match__");
if (delErr) {
  console.error("삭제 실패:", delErr.message);
  process.exit(1);
}
console.log("삭제 완료.");

console.log(`${rows.length}건 insert 시작...`);
const BATCH = 500;
let errors = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const { error } = await supabase.from("materials").insert(batch);
  const batchNo = Math.floor(i / BATCH) + 1;
  const total   = Math.ceil(rows.length / BATCH);
  if (error) {
    console.error(`  배치 ${batchNo}/${total} 오류: ${error.message}`);
    errors++;
  } else {
    console.log(`  배치 ${batchNo}/${total} 완료 (${Math.min(i + BATCH, rows.length)}/${rows.length}건)`);
  }
}

const { count: afterCount } = await supabase
  .from("materials").select("*", { count: "exact", head: true });
console.log(`\n최종 materials 행 수: ${afterCount}건`);
if (errors === 0) console.log("✓ 초기화+재삽입 완료");
else console.log(`완료 (오류 ${errors}배치)`);
