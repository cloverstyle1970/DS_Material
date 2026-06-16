// 신DB에 notifications/push_subscriptions 테이블 및 관련 컬럼 존재 확인
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

const q = async (label, sql, params = []) => {
  try {
    const r = await client.query(sql, params);
    console.log(`✓ ${label}: ${r.rows.length}행`);
    for (const row of r.rows) console.log('  ', row);
  } catch (e) {
    console.log(`✗ ${label}: ${e.message}`);
  }
};

await q(
  'notifications 테이블 존재?',
  `SELECT to_regclass('public.notifications') AS exists`
);
await q(
  'notifications 컬럼',
  `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' ORDER BY ordinal_position`
);
await q(
  'push_subscriptions 테이블 존재?',
  `SELECT to_regclass('public.push_subscriptions') AS exists`
);
await q(
  'push_subscriptions 컬럼',
  `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='push_subscriptions' ORDER BY ordinal_position`
);
await q(
  'accounts.push_enabled / notifications_enabled 컬럼',
  `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='accounts' AND column_name IN ('push_enabled','notifications_enabled')`
);
await q(
  'notifications 행 수(혹시 있다면)',
  `SELECT COUNT(*) AS cnt FROM notifications`
).catch(() => {});
await q(
  'push_subscriptions 행 수',
  `SELECT COUNT(*) AS cnt FROM push_subscriptions`
).catch(() => {});

await client.end();
