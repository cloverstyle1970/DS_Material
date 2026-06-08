// 엑셀의 elevator_number 기준으로 site_elevators 의 ledger_no / job_no / warranty_period 를 갱신한다.
//
// 처리 규칙:
//   1) 엑셀 행을 elevator_number 로 그룹핑
//   2) 각 컬럼에 대해 그룹 내 "비어있지 않은 첫 값" 채택
//   3) 그룹 전체가 모두 빈값인 컬럼은 UPDATE 대상에서 제외 (DB 기존값 보존)
//
// 사용: 환경변수 TARGET_DB_HOST / TARGET_DB_USER / TARGET_DB_PASSWORD 주입 후
//       node scripts/import-elevator-ledger.mjs

import xlsx from "xlsx";
import pg from "pg";

const { Client } = pg;
const XLSX_PATH = "C:/Users/황진한/Downloads/대솔이엘_관리현장_20260601_전체 원장번호입력.xlsx";

const wb = xlsx.readFile(XLSX_PATH);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { defval: null, raw: false });
console.log(`📄 ${wb.SheetNames[0]}: ${rows.length}행`);

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 그룹핑: elevator_number → { ledger_no, job_no, warranty_period }
const grouped = new Map();
let blankKey = 0;
for (const r of rows) {
  const key = clean(r.elevator_number);
  if (!key) { blankKey++; continue; }
  if (!grouped.has(key)) grouped.set(key, { ledger_no: null, job_no: null, warranty_period: null });
  const g = grouped.get(key);
  if (g.ledger_no       == null) g.ledger_no       = clean(r["원장번호"]);
  if (g.job_no          == null) g.job_no          = clean(r["job_no"]);
  if (g.warranty_period == null) g.warranty_period = clean(r["하자기간"]);
}
console.log(`✓ 그룹화: ${grouped.size}개 elevator_number (빈 키 ${blankKey}행 무시)`);

// 컬럼별 채워진 그룹 수 통계
let hasLedger = 0, hasJob = 0, hasWarranty = 0, allBlank = 0;
for (const g of grouped.values()) {
  if (g.ledger_no)       hasLedger++;
  if (g.job_no)          hasJob++;
  if (g.warranty_period) hasWarranty++;
  if (!g.ledger_no && !g.job_no && !g.warranty_period) allBlank++;
}
console.log(`  원장번호 ${hasLedger} / job_no ${hasJob} / 하자기간 ${hasWarranty} / 셋 다 빈값 ${allBlank}`);

// 모두 빈값인 그룹은 업데이트 스킵 (DB 보존)
const updateTargets = [...grouped.entries()].filter(([, g]) => g.ledger_no || g.job_no || g.warranty_period);
console.log(`  업데이트 대상 그룹: ${updateTargets.length}`);

const client = new Client({
  host: process.env.TARGET_DB_HOST,
  port: 5432,
  user: process.env.TARGET_DB_USER,
  password: process.env.TARGET_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  query_timeout: 120000,
});
await client.connect();
console.log(`✅ 연결: ${process.env.TARGET_DB_HOST}`);

// 일괄 처리: 임시 테이블 INSERT 후 한 번에 UPDATE FROM
await client.query("BEGIN");
try {
  await client.query(`
    CREATE TEMP TABLE _ledger_in (
      elevator_number TEXT PRIMARY KEY,
      ledger_no       TEXT,
      job_no          TEXT,
      warranty_period TEXT
    ) ON COMMIT DROP
  `);

  // 청크 단위 INSERT (Postgres parameter 한도 회피)
  const CHUNK = 200;
  for (let i = 0; i < updateTargets.length; i += CHUNK) {
    const chunk = updateTargets.slice(i, i + CHUNK);
    const params = [];
    const valuePh = chunk.map(([eno, g], idx) => {
      const base = idx * 4;
      params.push(eno, g.ledger_no, g.job_no, g.warranty_period);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    }).join(", ");
    await client.query(
      `INSERT INTO _ledger_in (elevator_number, ledger_no, job_no, warranty_period) VALUES ${valuePh}
       ON CONFLICT (elevator_number) DO UPDATE SET
         ledger_no       = COALESCE(_ledger_in.ledger_no,       EXCLUDED.ledger_no),
         job_no          = COALESCE(_ledger_in.job_no,          EXCLUDED.job_no),
         warranty_period = COALESCE(_ledger_in.warranty_period, EXCLUDED.warranty_period)`,
      params
    );
  }

  // UPDATE: 입력값이 NULL이면 DB 기존값 유지 (COALESCE)
  const upd = await client.query(`
    UPDATE public.site_elevators se
       SET ledger_no       = COALESCE(li.ledger_no,       se.ledger_no),
           job_no          = COALESCE(li.job_no,          se.job_no),
           warranty_period = COALESCE(li.warranty_period, se.warranty_period)
      FROM _ledger_in li
     WHERE se.elevator_number = li.elevator_number
  `);
  console.log(`✓ UPDATE 행수: ${upd.rowCount}`);

  // 매칭 안 된 elevator_number 수
  const unmatched = await client.query(`
    SELECT COUNT(*)::int AS n
      FROM _ledger_in li
     WHERE NOT EXISTS (SELECT 1 FROM public.site_elevators se WHERE se.elevator_number = li.elevator_number)
  `);
  console.log(`  엑셀에 있으나 DB 미매칭: ${unmatched.rows[0].n}`);

  await client.query("COMMIT");
  console.log("✅ 커밋 완료");

  // 검증
  const verify = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(ledger_no)::int       AS has_ledger,
           COUNT(job_no)::int          AS has_job,
           COUNT(warranty_period)::int AS has_warranty
      FROM public.site_elevators
  `);
  console.log("=== site_elevators 현재 상태 ===");
  console.table(verify.rows);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("❌ 실패. 롤백:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
