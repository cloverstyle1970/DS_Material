// 직접접속으로 permissions 컬럼 타입·permission_groups 행 수 확인
import pg from 'pg';
const c = new pg.Client({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com', port: 5432,
  user: 'postgres.bbnmxwpacdfqvicybhau', database: 'postgres',
  password: process.env.TARGET_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const types = await c.query(`
  SELECT table_name, column_name, data_type, udt_name
  FROM information_schema.columns
  WHERE table_schema='public' AND column_name='permissions'
    AND table_name IN ('accounts','permission_groups')`);
console.dir(types.rows);
const cnt = await c.query(`SELECT
  (SELECT COUNT(*) FROM accounts) AS accounts,
  (SELECT COUNT(*) FROM permission_groups) AS groups`);
console.dir(cnt.rows);
await c.end();
