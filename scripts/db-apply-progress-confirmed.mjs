// 신DB에 construction_schedules.progress_confirmed 컬럼을 추가한다.
// 사용: TARGET_DB_PASSWORD=<비번> node scripts/db-apply-progress-confirmed.mjs
import pg from "pg";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "migration-add-construction-progress-confirmed.sql");

const password = process.env.TARGET_DB_PASSWORD;
if (!password) {
  console.error("❌ TARGET_DB_PASSWORD 환경변수가 비어 있습니다.");
  process.exit(1);
}

const client = new pg.Client({
  host: "aws-1-ap-northeast-2.pooler.supabase.com",
  port: 5432,
  user: "postgres.bbnmxwpacdfqvicybhau",
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

try {
  await client.connect();
  console.log("✅ 신DB 접속 성공");

  const sql = readFileSync(sqlPath, "utf8");
  console.log(`📄 마이그레이션 파일: ${sqlPath}`);
  const result = await client.query(sql);
  const verification = Array.isArray(result) ? result[result.length - 1] : result;
  console.log("📊 검증 결과:");
  console.table(verification.rows ?? []);
  console.log("✅ 적용 완료");
} catch (err) {
  console.error("❌ 적용 실패:", err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
