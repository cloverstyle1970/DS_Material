import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SRC = path.join(ROOT, "Part_Price_List.xls");
const OUT = path.join(ROOT, "src", "data", "part-list.json");
const CREATED_AT = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const wb = XLSX.readFile(SRC);

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function readSheet(name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`?úÌä∏ ?ÑÎùΩ: ${name}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  // header: part_no, ?àÎ™Ö, Í∑úÍ≤©, Íµ¨Îß§?®Í?, ?êÎß§?®Í?, ?ÑÎ≤à, ?®ÏúÑ
  return rows.slice(1)
    .filter(r => String(r[0] ?? "").trim())
    .map(r => ({
      partNo:    String(r[0]).trim(),
      name:      str(r[1]) ?? "",
      modelNo:   str(r[2]),
      buyPrice:  num(r[3]),
      sellPrice: num(r[4]),
      drawingNo: str(r[5]),
      unit:      str(r[6]) ?? "EA",
    }));
}

function toRecord(row) {
  return {
    id:           row.partNo,
    categoryCode: "",
    name:         row.name,
    alias:        null,
    modelNo:      row.modelNo,
    unit:         row.unit,
    buyPrice:     row.buyPrice,
    sellPrice:    row.sellPrice,
    storageLoc:   null,
    stockQty:     0,
    isRepair:     row.partNo.endsWith("R"),
    eCountCd:     null,
    createdAt:    CREATED_AT,
  };
}

const tkRows = readSheet("TK?êÏû¨");
const dsRows = readSheet("DS?êÏû¨");

const all = [...tkRows, ...dsRows].map(toRecord);

const seen = new Map();
for (const rec of all) {
  if (seen.has(rec.id)) {
    console.warn(`Ï§ëÎ≥µ id Î¨¥Ïãú: ${rec.id}`);
    continue;
  }
  seen.set(rec.id, rec);
}
const dedup = [...seen.values()];

fs.writeFileSync(OUT, JSON.stringify(dedup, null, 2), "utf-8");
console.log(`TK ${tkRows.length}Í±?+ DS ${dsRows.length}Í±???${dedup.length}Í±??ëÏÑ±: ${OUT}`);
