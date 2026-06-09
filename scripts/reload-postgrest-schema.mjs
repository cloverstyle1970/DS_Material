// PostgREST 스키마 캐시 강제 reload.
// 신DB에 새 테이블/컬럼을 만들고 나서도 PostgREST가 즉시 인지하지 못해
// PGRST205("Could not find the table") 가 발생할 때 1회성으로 실행한다.
// 사용:
//   $env:TARGET_DB_HOST="aws-1-ap-northeast-2.pooler.supabase.com"
//   $env:TARGET_DB_USER="postgres.bbnmxwpacdfqvicybhau"
//   $env:TARGET_DB_PASSWORD="..."
//   node scripts/reload-postgrest-schema.mjs
import pg from "pg";

const { Client } = pg;

const host = process.env.TARGET_DB_HOST;
const user = process.env.TARGET_DB_USER;
const password = process.env.TARGET_DB_PASSWORD;
if (!host || !user || !password) {
  console.error("환경변수 TARGET_DB_HOST / TARGET_DB_USER / TARGET_DB_PASSWORD 가 필요합니다.");
  process.exit(1);
}

const client = new Client({
  host, port: 5432, user, password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

await client.connect();
console.log(`✅ 연결: ${host}`);

try {
  // PostgREST 가 LISTEN 중인 채널에 시그널을 보낸다.
  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log("✅ NOTIFY pgrst 전송 완료 — 수 초 내 스키마 캐시가 갱신됩니다.");
} catch (e) {
  console.error("❌ NOTIFY 실패:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
