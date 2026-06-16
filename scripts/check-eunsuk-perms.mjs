// 박은숙 사원의 권한 값 + 소속 권한그룹 직접 SELECT (pg)
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com',
  port: 5432,
  user: 'postgres.bbnmxwpacdfqvicybhau',
  database: 'postgres',
  password: process.env.TARGET_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const a = await client.query(`
  SELECT id, username, name, dept, team, permission_group_id, permissions
  FROM accounts
  WHERE username = '박은숙' OR name = '박은숙'
`);
console.log('=== accounts (박은숙) ===');
for (const r of a.rows) {
  console.log(`id=${r.id} username=${r.username ?? '-'} name=${r.name ?? '-'} dept=${r.dept ?? '-'} team=${r.team ?? '-'} permission_group_id=${r.permission_group_id ?? '-'}`);
  console.log('  permissions =', JSON.stringify(r.permissions));
}

if (a.rows.length) {
  const gid = a.rows[0].permission_group_id;
  if (gid) {
    const g = await client.query('SELECT id, name, permissions FROM permission_groups WHERE id = $1', [gid]);
    console.log('\n=== permission_group ===');
    for (const r of g.rows) {
      console.log(`[#${r.id}] ${r.name}`);
      console.log('  permissions =', JSON.stringify(r.permissions));
    }
  }
}

console.log('\n=== 모든 permission_groups ===');
const gs = await client.query('SELECT id, name, array_length(permissions,1) AS cnt FROM permission_groups ORDER BY id');
for (const r of gs.rows) console.log(`[#${r.id}] ${r.name} (${r.cnt ?? 0}개)`);

await client.end();
