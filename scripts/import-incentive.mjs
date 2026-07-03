// 인센티브 엑셀 → incentive_records 적재 (해당 월 단위 replace)
//
// 사용:
//   $env:TARGET_DB_HOST="aws-1-ap-northeast-2.pooler.supabase.com"
//   $env:TARGET_DB_USER="postgres.bbnmxwpacdfqvicybhau"
//   $env:TARGET_DB_PASSWORD="..."
//   node scripts/import-incentive.mjs "C:/Users/황진한/Downloads/인센티브2026-01-04 입력.xlsx"
//
// 사전조건: Supabase Dashboard 에서 scripts/migration-incentive.sql 을 먼저 실행해
//           incentive_records 테이블 및 company/region/issue_date 컬럼이 생성되어 있어야 함.
//
// 컬럼 매핑 (엑셀 → DB):
//   A 회사   → company
//   B 지역   → region
//   C 발행일 → issue_date (YYYY.MM.DD → YYYY-MM-DD),  month(YYYY-MM) 도출
//   D 현 장 명 → site
//   E 계약 내역 → contract
//   F 견적가 → quote
//   G 확정가 → fixed
//   H 자재비 → material
//   L 담당자 → manager
//   M 비고   → remark
//
// I/J/K (Nego, 순수자재비, 인센티브)는 저장하지 않고 페이지에서 자동 계산.

import XLSX from "xlsx";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const file = process.argv[2];
if (!file) {
  console.error("사용법: node scripts/import-incentive.mjs <엑셀 경로>");
  process.exit(1);
}

// "2026.01.30" | "2026-01-30" | Date → "YYYY-MM-DD"
function parseYmd(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw)) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
  }
  const s = String(raw).trim();
  const m = s.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]); const mm = Number(m[2]); const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const T = (v) => { const s = (v ?? "").toString().trim(); return s === "" ? "" : s; };

// 회사 별칭 (엑셀 표기 → DB 코드)
const COMPANY_ALIAS = { "대솔": "DS", "티센": "TK", "DS": "DS", "TK": "TK" };
function normalizeCompany(v) {
  const s = (v ?? "").toString().trim();
  if (!s) return "";
  return COMPANY_ALIAS[s] ?? s;
}

console.log(`▶ 엑셀: ${file}`);
const wb = XLSX.readFile(file);
const sheetName = wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
console.log(`▶ 시트 '${sheetName}' 총 ${rows.length}행`);

// 병합된 셀은 첫 행에만 값이 남으므로 A/B/C 는 fill-forward 처리
let lastCompany = "";
let lastRegion  = "";
let lastIssue   = null;

const records = [];
for (let i = 1; i < rows.length; i++) {  // 0행은 헤더
  const r = rows[i];
  if (!r || r.length === 0) continue;

  const cCompany = T(r[0]);
  const cRegion  = T(r[1]);
  const cIssue   = T(r[2]);
  const site     = T(r[3]);
  const contract = T(r[4]);
  const quoteRaw = r[5];
  const fixedRaw = r[6];
  const matRaw   = r[7];
  const manager  = T(r[11]);
  const remark   = T(r[12]);

  if (cCompany) lastCompany = normalizeCompany(cCompany);
  if (cRegion)  lastRegion  = cRegion;
  if (cIssue) {
    const parsed = parseYmd(cIssue);
    if (parsed) lastIssue = parsed;
  }

  // 데이터 유효성: 최소 현장 or 금액 하나라도 있어야 저장
  const anyAmount =
    (quoteRaw !== "" && quoteRaw != null) ||
    (fixedRaw !== "" && fixedRaw != null) ||
    (matRaw   !== "" && matRaw   != null);
  if (!site && !contract && !anyAmount) continue;

  if (!lastIssue) {
    console.warn(`  ⚠ row ${i + 1}: 발행일이 아직 확정되지 않아 건너뜀`);
    continue;
  }
  if (!lastCompany || !lastRegion) {
    console.warn(`  ⚠ row ${i + 1}: 회사/지역이 아직 확정되지 않아 건너뜀`);
    continue;
  }

  records.push({
    month: lastIssue.slice(0, 7),
    issue_date: lastIssue,
    company: lastCompany,
    region: lastRegion,
    site,
    contract,
    quote: parseAmount(quoteRaw),
    fixed: parseAmount(fixedRaw),
    material: parseAmount(matRaw),
    manager,
    remark,
  });
}
console.log(`▶ 유효 데이터 ${records.length}건`);

// 지역·회사 매트릭스 검증 (경고만)
const KNOWN = { DS: ["화정","일산","파주","기타"], TK: ["화정","일산","파주"] };
for (const r of records) {
  const list = KNOWN[r.company];
  if (!list) console.warn(`  ⚠ 미지 회사: ${r.company} (row site=${r.site})`);
  else if (!list.includes(r.region)) console.warn(`  ⚠ 미지 지역: ${r.company}·${r.region} (row site=${r.site})`);
}

// 월별 그룹 (sort_order 는 DB 기존 max 조회 후 부여 — APPEND 모드 대응)
const byMonth = new Map();
for (const r of records) {
  if (!byMonth.has(r.month)) byMonth.set(r.month, []);
  byMonth.get(r.month).push(r);
}
console.log(`▶ 대상 월: ${Array.from(byMonth.keys()).sort().join(", ")}`);
console.log(`▶ 모드: ${process.env.APPEND === "1" ? "APPEND (기존 유지 + 뒤에 추가)" : "REPLACE (월 단위 교체)"}`);

// 파싱만 확인하고 DB 적재는 건너뛰려면 DRY_RUN=1
if (process.env.DRY_RUN === "1") {
  // DRY_RUN 은 DB 조회 없이 sort_order 미리보기 (append 모드에서도 0-base 로 표시)
  for (const list of byMonth.values()) {
    list.forEach((r, idx) => { r.sort_order = idx; });
  }
  console.log("▶ DRY_RUN=1 — DB 적재 건너뜀. 미리보기 상위 5건:");
  console.table(records.slice(0, 5));
  console.log(`▶ 하위 3건:`);
  console.table(records.slice(-3));
  process.exit(0);
}

if (!process.env.TARGET_DB_HOST || !process.env.TARGET_DB_PASSWORD) {
  console.error("❌ 환경변수 TARGET_DB_HOST / TARGET_DB_USER / TARGET_DB_PASSWORD 를 설정하세요.");
  process.exit(1);
}

const client = new Client({
  host: process.env.TARGET_DB_HOST, port: 5432,
  user: process.env.TARGET_DB_USER, password: process.env.TARGET_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000, statement_timeout: 300000,
});
await client.connect();
console.log(`✅ 연결: ${process.env.TARGET_DB_HOST}`);

const COLS = ["month","issue_date","company","region","site","contract","quote","fixed","material","manager","remark","sort_order"];

try {
  // 스키마 보장 — migration-incentive.sql 은 idempotent 이므로 매번 실행 안전
  const migPath = path.join(__dirname, "migration-incentive.sql");
  if (fs.existsSync(migPath)) {
    const sql = fs.readFileSync(migPath, "utf-8");
    await client.query(sql);
    console.log("✅ 스키마 보장 완료 (migration-incentive.sql)");
  }
  await client.query("BEGIN");
  const APPEND = process.env.APPEND === "1";
  if (APPEND) {
    // 각 월의 기존 max(sort_order) 뒤로 이어붙임
    for (const [m, list] of byMonth.entries()) {
      const q = await client.query(
        "SELECT COALESCE(MAX(sort_order), -1) AS max_so FROM incentive_records WHERE month = $1",
        [m]
      );
      const base = Number(q.rows[0].max_so) + 1;
      list.forEach((r, idx) => { r.sort_order = base + idx; });
      console.log(`  · ${m}: 기존 max sort_order=${base - 1} → 신규 ${list.length}건 (sort_order ${base}~${base + list.length - 1})`);
    }
  } else {
    // 대상 월들만 replace — 다른 월 데이터는 건들지 않는다
    for (const [m, list] of byMonth.entries()) {
      const del = await client.query("DELETE FROM incentive_records WHERE month = $1", [m]);
      list.forEach((r, idx) => { r.sort_order = idx; });
      console.log(`  · ${m}: 기존 ${del.rowCount}건 삭제`);
    }
  }
  const BATCH = 500;
  let done = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH);
    const values = [];
    const params = [];
    slice.forEach((rec, ri) => {
      const base = ri * COLS.length;
      values.push(`(${COLS.map((_, ci) => `$${base + ci + 1}`).join(",")})`);
      COLS.forEach(c => params.push(rec[c]));
    });
    await client.query(
      `INSERT INTO incentive_records (${COLS.join(",")}) VALUES ${values.join(",")}`,
      params
    );
    done += slice.length;
    if (done % 2000 < BATCH) console.log(`  ... ${done}/${records.length}`);
  }
  await client.query("COMMIT");
  console.log(`✅ 적재 완료: ${done}건`);

  const summary = await client.query(`
    SELECT month, company, region, count(*) AS n, sum(quote)::text AS quote_sum, sum(material)::text AS material_sum
    FROM incentive_records
    WHERE month = ANY($1)
    GROUP BY month, company, region
    ORDER BY month, company, region`, [Array.from(byMonth.keys())]);
  console.table(summary.rows);
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("❌ 적재 실패:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
