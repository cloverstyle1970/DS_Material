// 매출 세금계산서 발행내역 엑셀 → sales_invoices 적재 (전체 교체)
// 사용:
//   $env:TARGET_DB_HOST="aws-1-ap-northeast-2.pooler.supabase.com"
//   $env:TARGET_DB_USER="postgres.bbnmxwpacdfqvicybhau"
//   $env:TARGET_DB_PASSWORD="..."
//   node scripts/import-sales-invoices.mjs "C:/.../매출세금계산서.xls"
// 비밀번호는 환경변수로만 주입. 코드/커밋에 저장하지 않음.
import XLSX from "xlsx";
import pg from "pg";

const { Client } = pg;

const file = process.argv[2] || "C:/Users/J.H.Hwang/Downloads/매출세금계산서.xls";

// "20.01.02" → "2020-01-02" (yy.mm.dd). 실패 시 null
function parseYmd(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;
  const yy = Number(m[1]); const mm = Number(m[2]); const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = 2000 + yy;            // 데이터 범위 20~26년
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// 입금일자 "20.01.14기업" → { date: "2020-01-14", bank: "기업" }
function parseDeposit(raw) {
  if (!raw) return { date: null, bank: null };
  const s = String(raw).trim();
  const date = parseYmd(s);
  // 날짜 부분 이후 텍스트를 은행으로
  const m = s.match(/\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*(.*)$/);
  const bank = m && m[1] ? m[1].trim() : null;
  return { date, bank: bank || null };
}

function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const T = (v) => { const s = (v ?? "").toString().trim(); return s === "" ? null : s; };

console.log(`▶ 엑셀: ${file}`);
const wb = XLSX.readFile(file);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
console.log(`▶ 시트 '${wb.SheetNames[0]}' 총 ${rows.length}행`);

// 데이터: index 3부터, 발행일/현장/금액 중 하나라도 있으면 유효
const records = [];
for (let i = 3; i < rows.length; i++) {
  const r = rows[i];
  if (!r) continue;
  const hasData = T(r[4]) || T(r[6]) || T(r[8]) || T(r[5]);
  if (!hasData) continue;
  const dep = parseDeposit(r[9]);
  records.push({
    row_no: i,
    year_label: T(r[0]), month_label: T(r[1]),
    category: T(r[2]), tax_div: T(r[3]),
    issue_date: parseYmd(r[4]), issue_raw: T(r[4]),
    summary: T(r[5]), site_name: T(r[6]), vendor_name: T(r[7]),
    amount: parseAmount(r[8]),
    deposit_date: dep.date, deposit_raw: T(r[9]), deposit_bank: dep.bank,
    pay_status: T(r[10]), pay_method: T(r[11]),
    remark: T(r[12]), ledger_no: T(r[13]), contact: T(r[14]),
    etc: T(r[15]), long_overdue: T(r[16]),
  });
}
console.log(`▶ 유효 데이터 ${records.length}건`);

const client = new Client({
  host: process.env.TARGET_DB_HOST, port: 5432,
  user: process.env.TARGET_DB_USER, password: process.env.TARGET_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000, statement_timeout: 300000,
});
await client.connect();
console.log(`✅ 연결: ${process.env.TARGET_DB_HOST}`);

const COLS = ["row_no","year_label","month_label","category","tax_div","issue_date","issue_raw","summary","site_name","vendor_name","amount","deposit_date","deposit_raw","deposit_bank","pay_status","pay_method","remark","ledger_no","contact","etc","long_overdue"];

try {
  await client.query("TRUNCATE sales_invoices RESTART IDENTITY");
  console.log("✅ 기존 데이터 비움 (TRUNCATE)");

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
      `INSERT INTO sales_invoices (${COLS.join(",")}) VALUES ${values.join(",")}`,
      params
    );
    done += slice.length;
    if (done % 5000 < BATCH) console.log(`  ... ${done}/${records.length}`);
  }
  console.log(`✅ 적재 완료: ${done}건`);

  const chk = await client.query(`
    SELECT pay_status, count(*) AS n FROM sales_invoices GROUP BY pay_status ORDER BY n DESC`);
  console.table(chk.rows);
  const rng = await client.query(`
    SELECT min(issue_date) AS min_issue, max(issue_date) AS max_issue,
           count(*) FILTER (WHERE issue_date IS NULL) AS issue_null,
           count(*) FILTER (WHERE deposit_date IS NULL) AS deposit_null
    FROM sales_invoices`);
  console.table(rng.rows);
} catch (e) {
  console.error("❌ 적재 실패:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
