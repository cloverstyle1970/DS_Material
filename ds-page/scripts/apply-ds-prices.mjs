import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Excel 읽기
const wb = XLSX.readFile(path.join(ROOT, "DS PARR PRICE LIST.xlsx"));
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

// Part No → { buyPrice, sellPrice } 맵 생성
function parsePrice(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v.replace(/,/g, "")) || null;
  return null;
}

const priceMap = new Map();
for (const row of rows.slice(1)) {
  const id = String(row[0]).trim();
  if (!id || !id.startsWith("D")) continue;
  const buy  = parsePrice(row[4]);
  const sell = parsePrice(row[5]);
  if (buy || sell) priceMap.set(id, { buyPrice: buy, sellPrice: sell });
}
console.log(`가격 데이터: ${priceMap.size}건`);

// part-list.json 업데이트
const partListPath = path.join(ROOT, "src", "data", "part-list.json");
const materials = JSON.parse(fs.readFileSync(partListPath, "utf-8"));

let updated = 0;
for (const m of materials) {
  const prices = priceMap.get(m.id);
  if (prices) {
    if (prices.buyPrice  != null) m.buyPrice  = prices.buyPrice;
    if (prices.sellPrice != null) m.sellPrice = prices.sellPrice;
    updated++;
  }
}

fs.writeFileSync(partListPath, JSON.stringify(materials, null, 2), "utf-8");
console.log(`업데이트 완료: ${updated}/${materials.length}개 자재에 가격 적용`);
