// 급여명세서 엑셀 양식 분석용 일회성 스크립트.
// 사용: node scripts/inspect-payroll-excel.mjs "I:/급여명세서3.xlsx"
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("사용법: node scripts/inspect-payroll-excel.mjs <엑셀파일경로>");
  process.exit(1);
}

const buf = readFileSync(resolve(file));
const wb = XLSX.read(buf, { cellDates: false });

console.log(`\n=== 파일: ${file} ===`);
console.log(`전체 시트: ${wb.SheetNames.join(" | ")}\n`);

for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  const merges = sheet["!merges"] ?? [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  console.log(`\n──── 시트: '${name}' ────`);
  console.log(`  범위: ${sheet["!ref"]}  (총 ${rows.length}행)`);
  console.log(`  병합셀: ${merges.length}개`);

  // 처음 80행 출력 (각 행 비어있지 않은 셀만)
  console.log(`\n  [처음 80행]`);
  for (let i = 0; i < Math.min(80, rows.length); i++) {
    const row = rows[i] ?? [];
    const cells = row
      .map((c, ci) => (c != null && String(c).trim()) ? `[${XLSX.utils.encode_col(ci)}]${String(c).replace(/\s+/g, "").slice(0, 30)}` : null)
      .filter(Boolean);
    if (cells.length > 0) {
      console.log(`  ${String(i + 1).padStart(3)}행: ${cells.slice(0, 12).join(" | ")}`);
    }
  }

  // 병합셀 정보
  if (merges.length > 0 && merges.length <= 50) {
    console.log(`\n  [병합셀 목록]`);
    for (const m of merges) {
      const cell = sheet[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })];
      const val = cell?.v ? String(cell.v).replace(/\s+/g, "").slice(0, 40) : "";
      const fromAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
      const toAddr = XLSX.utils.encode_cell({ r: m.e.r, c: m.e.c });
      console.log(`    ${fromAddr}:${toAddr}  "${val}"`);
    }
  }
}
