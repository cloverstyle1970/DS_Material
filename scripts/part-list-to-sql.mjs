import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const partList = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src", "data", "part-list.json"), "utf-8")
);

function q(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const COLS = [
  "id", "category_code", "name", "alias", "model_no", "unit",
  "buy_price", "sell_price", "storage_loc", "stock_qty",
  "is_repair", "e_count_cd", "created_at",
];

function row(d) {
  return "(" + [
    q(d.id),
    q(d.categoryCode ?? ""),
    q(d.name),
    q(d.alias ?? null),
    q(d.modelNo ?? null),
    q(d.unit ?? null),
    d.buyPrice ?? "NULL",
    d.sellPrice ?? "NULL",
    q(d.storageLoc ?? null),
    d.stockQty ?? 0,
    d.isRepair ? "TRUE" : "FALSE",
    q(d.eCountCd ?? null),
    q(d.createdAt),
  ].join(", ") + ")";
}

const CHUNK = 500;
const lines = [];
lines.push("-- materials 테이블 초기화 후 재삽입");
lines.push("-- 생성: " + new Date().toISOString());
lines.push("-- 총 " + partList.length + "건");
lines.push("");
lines.push("BEGIN;");
lines.push("TRUNCATE TABLE materials RESTART IDENTITY CASCADE;");
lines.push("");

for (let i = 0; i < partList.length; i += CHUNK) {
  const batch = partList.slice(i, i + CHUNK);
  lines.push(`INSERT INTO materials (${COLS.join(", ")}) VALUES`);
  lines.push(batch.map(row).join(",\n") + ";");
  lines.push("");
}

lines.push("COMMIT;");

const out = path.join(ROOT, "scripts", "import-materials.sql");
fs.writeFileSync(out, lines.join("\n"), "utf-8");

const sizeKB = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`작성 완료: ${out} (${partList.length}건, ${sizeKB} KB)`);
