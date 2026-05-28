// pooler host 자동 탐지: prefix(aws-0/aws-1) × region 조합 시도
// 실행: node --env-file=.env.local scripts/db-find-region.mjs
import pg from "pg";
import dns from "node:dns/promises";
const { Client } = pg;

const PREFIXES = ["aws-0", "aws-1"];
const REGIONS = [
  "ap-northeast-2", "ap-northeast-1", "ap-southeast-1", "ap-southeast-2",
  "ap-south-1", "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-central-1", "eu-central-2", "eu-west-1", "eu-west-2", "eu-west-3",
  "sa-east-1", "ca-central-1",
];

const PROJECTS = [
  { label: "SOURCE 구DB", ref: "gwgzzsoknjulwwsmubju", pw: process.env.SOURCE_DB_PASSWORD },
  { label: "TARGET 신DB", ref: "bbnmxwpacdfqvicybhau", pw: process.env.TARGET_DB_PASSWORD },
];

async function tryHost(ref, pw, host) {
  try { await dns.lookup(host); } catch { return { ok: false, dns: false }; }
  const c = new Client({
    host, port: 5432, user: `postgres.${ref}`, password: pw, database: "postgres",
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000,
  });
  try { await c.connect(); await c.query("select 1"); await c.end();
    return { ok: true }; }
  catch (e) { try { await c.end(); } catch {} return { ok: false, dns: true, reason: e.message }; }
}

for (const p of PROJECTS) {
  console.log(`\n=== ${p.label} (${p.ref}) ===`);
  let found = null;
  outer:
  for (const region of REGIONS) {
    for (const prefix of PREFIXES) {
      const host = `${prefix}-${region}.pooler.supabase.com`;
      const res = await tryHost(p.ref, p.pw, host);
      if (res.ok) { found = host; console.log(`  ✅ ${host}`); break outer; }
      if (res.dns) console.log(`  ✗  ${host}  →  ${res.reason}`);
    }
  }
  if (found) console.log(`  → HOST=${found}  USER=postgres.${p.ref}`);
  else console.log("  → 못 찾음.");
}
