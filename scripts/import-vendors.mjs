import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const wb = XLSX.readFile(path.join(ROOT, "거래처리스트.xlsx"));
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

function str(v) { return v != null && v !== "" ? String(v).trim() : null; }

const vendors = [];
let id = 1;

for (const row of rows.slice(1)) {
  const name = str(row[1]);
  if (!name) continue;

  const rawType = str(row[13]) ?? "매출";
  // "매입/매출" → "공통"
  const type = rawType === "매입/매출" ? "공통" : rawType;

  vendors.push({
    id: id++,
    vendorCode: str(row[0]),
    name,
    bizNo:           str(row[2]),
    representative:  str(row[3]),
    bizType:         str(row[5]),
    bizItem:         str(row[6]),
    postalCode:      str(row[7]),
    address:         str(row[8]),
    phone:           str(row[9]),
    fax:             str(row[10]),
    invoiceManager:  str(row[11]),
    invoiceEmail:    str(row[12]),
    type,           // "매출" | "매입" | "공통"
  });
}

const outPath = path.join(ROOT, "src", "data", "vendors.json");
fs.writeFileSync(outPath, JSON.stringify(vendors, null, 2), "utf-8");

const byType = vendors.reduce((acc, v) => { acc[v.type] = (acc[v.type]||0)+1; return acc; }, {});
console.log(`거래처 임포트 완료: 총 ${vendors.length}개`);
console.log("구분별:", JSON.stringify(byType));
