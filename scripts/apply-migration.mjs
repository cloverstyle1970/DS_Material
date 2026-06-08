// 단일 SQL 마이그레이션 파일을 신DB에 적용한다.
// 사용:
//   $env:TARGET_DB_HOST="aws-1-ap-northeast-2.pooler.supabase.com"
//   $env:TARGET_DB_USER="postgres.bbnmxwpacdfqvicybhau"
//   $env:TARGET_DB_PASSWORD="..."
//   node scripts/apply-migration.mjs scripts/migration-xxx.sql
//
// 비밀번호는 환경변수로만 주입한다. 코드/메모리에 저장하지 않는다.
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Client } = pg;

const file = process.argv[2];
if (!file) {
  console.error("사용법: node scripts/apply-migration.mjs <sql-file>");
  process.exit(1);
}

const host = process.env.TARGET_DB_HOST;
const user = process.env.TARGET_DB_USER;
const password = process.env.TARGET_DB_PASSWORD;
if (!host || !user || !password) {
  console.error("환경변수 TARGET_DB_HOST / TARGET_DB_USER / TARGET_DB_PASSWORD 가 필요합니다.");
  process.exit(1);
}

const sqlPath = resolve(file);
const sql = readFileSync(sqlPath, "utf8");
console.log(`▶ SQL 파일: ${sqlPath}`);
console.log(`▶ 길이: ${sql.length} bytes`);

const client = new Client({
  host, port: 5432, user, password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  query_timeout: 120000,
  statement_timeout: 120000,
});

await client.connect();
console.log(`✅ 연결: ${host}`);

try {
  const result = await client.query(sql);
  // pg는 다중 statement인 경우 결과 배열 반환
  if (Array.isArray(result)) {
    for (const [i, r] of result.entries()) {
      console.log(`  [${i}] command=${r.command} rowCount=${r.rowCount}`);
      if (r.rows && r.rows.length > 0 && r.rows.length <= 10) {
        console.table(r.rows);
      }
    }
  } else {
    console.log(`  command=${result.command} rowCount=${result.rowCount}`);
    if (result.rows && result.rows.length > 0 && result.rows.length <= 10) {
      console.table(result.rows);
    }
  }
  console.log("✅ 적용 완료");
} catch (e) {
  console.error("❌ SQL 실행 실패:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
