// 신DB 용량/사용량 점검.
// 사용:
//   $env:TARGET_DB_HOST="aws-1-ap-northeast-2.pooler.supabase.com"
//   $env:TARGET_DB_USER="postgres.bbnmxwpacdfqvicybhau"
//   $env:TARGET_DB_PASSWORD="..."
//   node scripts/check-db-usage.mjs
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
  host, port: 5432, user, password, database: "postgres",
  ssl: { rejectUnauthorized: false },
});

const fmtBytes = (n) => {
  if (n == null) return "-";
  const num = Number(n);
  if (num < 1024) return `${num} B`;
  if (num < 1024 ** 2) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 ** 3) return `${(num / 1024 ** 2).toFixed(1)} MB`;
  return `${(num / 1024 ** 3).toFixed(2)} GB`;
};

await client.connect();

try {
  // 1. 전체 DB 크기
  const { rows: dbRows } = await client.query(`
    SELECT pg_database.datname AS db,
           pg_database_size(pg_database.datname) AS bytes
      FROM pg_database
     WHERE datname = current_database()`);
  const dbSize = Number(dbRows[0]?.bytes ?? 0);
  console.log("=".repeat(70));
  console.log(`전체 DB 크기: ${fmtBytes(dbSize)}  (${dbSize.toLocaleString()} bytes)`);
  console.log("=".repeat(70));

  // 2. 스키마별 크기 요약
  const { rows: schemaRows } = await client.query(`
    SELECT n.nspname AS schema,
           sum(pg_total_relation_size(c.oid))::bigint AS bytes,
           count(*) FILTER (WHERE c.relkind IN ('r','p')) AS tables
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p','m','i','t')
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
     GROUP BY n.nspname
     ORDER BY bytes DESC NULLS LAST`);
  console.log("\n[스키마별 총 크기]");
  console.log("스키마".padEnd(20), "크기".padStart(12), "테이블수".padStart(10));
  for (const r of schemaRows) {
    console.log(String(r.schema).padEnd(20), fmtBytes(r.bytes).padStart(12), String(r.tables ?? "-").padStart(10));
  }

  // 3. 테이블별 크기 상위 25개 (public + storage)
  const { rows: tblRows } = await client.query(`
    SELECT n.nspname AS schema,
           c.relname AS table,
           pg_total_relation_size(c.oid) AS total_bytes,
           pg_relation_size(c.oid) AS data_bytes,
           pg_indexes_size(c.oid) AS index_bytes,
           COALESCE(pg_total_relation_size(reltoastrelid), 0) AS toast_bytes,
           (SELECT reltuples::bigint FROM pg_class WHERE oid = c.oid) AS approx_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p')
       AND n.nspname IN ('public','storage','auth')
     ORDER BY pg_total_relation_size(c.oid) DESC
     LIMIT 25`);
  console.log("\n[테이블별 크기 상위 25개]");
  console.log(
    "스키마.테이블".padEnd(50),
    "총".padStart(10),
    "데이터".padStart(10),
    "인덱스".padStart(10),
    "TOAST".padStart(10),
    "행(추정)".padStart(12),
  );
  for (const r of tblRows) {
    console.log(
      `${r.schema}.${r.table}`.padEnd(50),
      fmtBytes(r.total_bytes).padStart(10),
      fmtBytes(r.data_bytes).padStart(10),
      fmtBytes(r.index_bytes).padStart(10),
      fmtBytes(r.toast_bytes).padStart(10),
      String(r.approx_rows ?? "-").padStart(12),
    );
  }

  // 4. public 스키마 정확한 행 수 (상위 20개, 크기 기준)
  const { rows: publicTbls } = await client.query(`
    SELECT relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p')
       AND n.nspname = 'public'
     ORDER BY pg_total_relation_size(c.oid) DESC
     LIMIT 20`);
  console.log("\n[public 테이블 정확한 행 수 상위 20개]");
  for (const t of publicTbls) {
    try {
      const { rows } = await client.query(`SELECT count(*)::bigint AS c FROM public."${t.name}"`);
      console.log(String(t.name).padEnd(50), String(rows[0].c).padStart(12));
    } catch (e) {
      console.log(String(t.name).padEnd(50), `ERR: ${e.message}`.padStart(12));
    }
  }

  // 5. storage.objects (파일 개수 및 크기 합계)
  try {
    const { rows: stRows } = await client.query(`
      SELECT bucket_id,
             count(*) AS files,
             COALESCE(sum((metadata->>'size')::bigint), 0) AS bytes
        FROM storage.objects
       GROUP BY bucket_id
       ORDER BY bytes DESC`);
    console.log("\n[Storage 버킷별 파일 크기]");
    console.log("버킷".padEnd(30), "파일수".padStart(10), "크기".padStart(12));
    let totalBytes = 0;
    for (const r of stRows) {
      totalBytes += Number(r.bytes);
      console.log(String(r.bucket_id).padEnd(30), String(r.files).padStart(10), fmtBytes(r.bytes).padStart(12));
    }
    console.log("-".repeat(52));
    console.log("합계".padEnd(30), " ".padStart(10), fmtBytes(totalBytes).padStart(12));
  } catch (e) {
    console.log(`\n[Storage 조회 실패] ${e.message}`);
  }

  // 6. 데드 튜플 상위 (VACUUM 필요 여부 판단)
  const { rows: deadRows } = await client.query(`
    SELECT schemaname AS schema, relname AS table,
           n_live_tup AS live, n_dead_tup AS dead,
           CASE WHEN n_live_tup > 0
                THEN round(100.0 * n_dead_tup / n_live_tup, 1)
                ELSE NULL END AS dead_pct,
           last_autovacuum, last_autoanalyze
      FROM pg_stat_user_tables
     WHERE n_dead_tup > 0
     ORDER BY n_dead_tup DESC
     LIMIT 10`);
  if (deadRows.length > 0) {
    console.log("\n[데드 튜플 상위 10개 (VACUUM 참고)]");
    console.log(
      "스키마.테이블".padEnd(50),
      "live".padStart(10),
      "dead".padStart(10),
      "dead%".padStart(7),
    );
    for (const r of deadRows) {
      console.log(
        `${r.schema}.${r.table}`.padEnd(50),
        String(r.live).padStart(10),
        String(r.dead).padStart(10),
        String(r.dead_pct ?? "-").padStart(7),
      );
    }
  }

  // 7. 요약 및 Supabase 티어 참고선
  console.log("\n" + "=".repeat(70));
  console.log("[요약]");
  console.log(`- 전체 DB: ${fmtBytes(dbSize)}`);
  console.log(`  · Supabase Free tier 한도: 500 MB (${(dbSize / (500 * 1024 ** 2) * 100).toFixed(1)}% 사용)`);
  console.log(`  · Supabase Pro  tier 한도: 8 GB (${(dbSize / (8 * 1024 ** 3) * 100).toFixed(1)}% 사용)`);
  console.log("=".repeat(70));
} finally {
  await client.end();
}
