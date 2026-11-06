import pg from "pg";
import { readFileSync } from "fs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter(l => l && !l.startsWith("#"))
    .map(l => l.split("=")).filter(p => p.length >= 2)
    .map(p => [p[0].trim(), p.slice(1).join("=").trim()])
);

const sql = readFileSync(new URL("./migration-sales-invoices-site-keywords.sql", import.meta.url), "utf-8");

const client = new pg.Client({
  host: env.TARGET_DB_HOST,
  user: env.TARGET_DB_USER,
  password: env.TARGET_DB_PASSWORD,
  port: 5432,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await client.connect();

try {
  console.log("마이그레이션 적용 중...");
  const res = await client.query(sql);
  // 마지막 SELECT 결과
  const last = Array.isArray(res) ? res[res.length - 1] : res;
  if (last.rows) {
    console.log("\n[검증] 함수 재생성 확인:");
    for (const r of last.rows) console.log(`  ${r.proname}(${r.args})`);
  }
  console.log("\n✅ 적용 완료");
} catch (e) {
  console.error("❌ 실패:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
