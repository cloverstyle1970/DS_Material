// "명세서(이엘)" 시트 전용 상세 분석.
// 사용: node scripts/inspect-payslip-sheet.mjs "I:/급여명세서3.xlsx" "명세서(이엘)"
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = process.argv[2];
const sheetName = process.argv[3] ?? "명세서(이엘)";
const showRows = Number(process.argv[4] ?? 60);

const buf = readFileSync(resolve(file));
const wb = XLSX.read(buf, { cellDates: false });

const sheet = wb.Sheets[sheetName];
if (!sheet) {
  console.error(`시트 '${sheetName}' 없음. 가능: ${wb.SheetNames.join(" | ")}`);
  process.exit(1);
}

const range = sheet["!ref"];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
const merges = sheet["!merges"] ?? [];

console.log(`\n=== 시트: '${sheetName}' ===`);
console.log(`범위: ${range}  (총 ${rows.length}행)`);
console.log(`병합셀: ${merges.length}개\n`);

// 전체 행 출력 (최대 showRows)
console.log(`[행별 셀 내용 — 최대 ${showRows}행]`);
for (let i = 0; i < Math.min(showRows, rows.length); i++) {
  const row = rows[i] ?? [];
  const cells = row
    .map((c, ci) => (c != null && String(c).trim()) ? `[${XLSX.utils.encode_col(ci)}]${String(c).replace(/\s+/g, " ").slice(0, 30)}` : null)
    .filter(Boolean);
  if (cells.length > 0) {
    console.log(`${String(i + 1).padStart(3)}행: ${cells.join(" | ")}`);
  } else {
    console.log(`${String(i + 1).padStart(3)}행: (빈 행)`);
  }
}

// 병합셀 — 마커가 될만한 것만
console.log(`\n[병합셀 목록 (전부)]`);
for (const m of merges) {
  const cell = sheet[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
  const val = cell?.v ? String(cell.v).replace(/\s+/g, "").slice(0, 50) : "";
  const fromAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
  const toAddr = XLSX.utils.encode_cell({ r: m.e.r, c: m.e.c });
  console.log(`  ${fromAddr}:${toAddr}  "${val}"`);
}
