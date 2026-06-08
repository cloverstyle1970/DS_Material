// 엑셀에는 있으나 site_elevators 에 없는 elevator_number 목록을 엑셀 파일로 출력.
import xlsx from "xlsx";
import pg from "pg";
import { resolve } from "path";

const { Client } = pg;
const SRC_XLSX = "C:/Users/황진한/Downloads/대솔이엘_관리현장_20260601_전체 원장번호입력.xlsx";
const OUT_XLSX = "C:/Users/황진한/Downloads/미매칭_elevator_20260608.xlsx";

const wb = xlsx.readFile(SRC_XLSX);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { defval: null, raw: false });

function clean(v) { if (v == null) return null; const s = String(v).trim(); return s === "" ? null : s; }

// 엑셀의 모든 컬럼을 보존하면서 elevator_number 그룹화
const grouped = new Map();
for (const r of rows) {
  const key = clean(r.elevator_number);
  if (!key) continue;
  if (!grouped.has(key)) grouped.set(key, { elevator_number: key });
  const g = grouped.get(key);
  for (const [k, v] of Object.entries(r)) {
    if (k === "elevator_number") continue;
    if (g[k] == null) g[k] = clean(v);
  }
}

const client = new Client({
  host: process.env.TARGET_DB_HOST,
  port: 5432,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const existing = new Set((await client.query(`SELECT elevator_number FROM public.site_elevators`)).rows.map(r => r.elevator_number));
await client.end();

const unmatched = [...grouped.values()].filter(g => !existing.has(g.elevator_number));
console.log(`미매칭 ${unmatched.length}건`);

const outWb = xlsx.utils.book_new();
const outSheet = xlsx.utils.json_to_sheet(unmatched);
xlsx.utils.book_append_sheet(outWb, outSheet, "미매칭");
xlsx.writeFile(outWb, OUT_XLSX);
console.log(`✅ 저장: ${resolve(OUT_XLSX)}`);
