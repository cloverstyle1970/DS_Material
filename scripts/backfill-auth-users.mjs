// 누락된 auth.users 백필 — accounts에는 있지만 auth.users(`${id}@daesol.el`)가 없는 사용자에 대해
// 유지보수 사이트와 동일한 admin-auth-ops Edge Function 의 'create' 액션을 호출한다.
// 비번은 현재 accounts.password(평문)을 그대로 사용 → 두 시스템 비번 일치.
//
// 사용:  TARGET_DB_PASSWORD=... node scripts/backfill-auth-users.mjs

import pg from "pg";
const { Client } = pg;

const SUPABASE_URL = "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I";

const c = new Client({
  host: "aws-1-ap-northeast-2.pooler.supabase.com",
  port: 5432,
  user: "postgres.bbnmxwpacdfqvicybhau",
  database: "postgres",
  password: process.env.TARGET_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

await c.connect();

const { rows: missing } = await c.query(`
  select a.id, a.username, a.password
  from public.accounts a
  left join auth.users u on u.email = a.id::text || '@daesol.el'
  where u.id is null
  order by a.id
`);

console.log(`백필 대상: ${missing.length}건`);

let okCount = 0, failCount = 0;
for (const r of missing) {
  const password = r.password || "000000"; // 평문이 비어 있으면 000000으로 보정 (이론상 없을 케이스)
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-auth-ops`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "create", account_id: Number(r.id), password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    console.log(`  ✗ id=${r.id} (${r.username}) — HTTP ${res.status} ${body?.error || ""}`);
    failCount++;
  } else {
    console.log(`  ✓ id=${r.id} (${r.username})`);
    okCount++;
  }
}

console.log(`\n결과: 성공 ${okCount} / 실패 ${failCount}`);

// 검증
const { rows: again } = await c.query(`
  select count(*)::int as n
  from public.accounts a
  left join auth.users u on u.email = a.id::text || '@daesol.el'
  where u.id is null
`);
console.log(`잔존 누락: ${again[0].n}건`);

await c.end();
