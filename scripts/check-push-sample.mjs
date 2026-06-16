// push_subscriptions 실제 데이터 샘플로 스키마 사용 방식 파악
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

// 컬럼별 NULL 비율, UNIQUE 제약, 샘플
console.log('=== 컬럼 통계 ===');
const r1 = await client.query(`
  SELECT
    COUNT(*) AS total,
    COUNT(account_id) AS has_account,
    COUNT(username) AS has_username,
    COUNT(endpoint) AS has_endpoint,
    COUNT(subscription) AS has_subscription,
    COUNT(is_mobile) AS has_is_mobile,
    COUNT(DISTINCT account_id) AS uniq_accounts,
    COUNT(DISTINCT endpoint) AS uniq_endpoints
  FROM push_subscriptions
`);
console.dir(r1.rows[0]);

console.log('\n=== 샘플 3건 (값 일부 마스킹) ===');
const r2 = await client.query(`
  SELECT id, account_id, username, is_mobile, LEFT(endpoint, 60) AS endpoint_head,
         subscription->>'endpoint' IS NOT NULL AS sub_has_endpoint,
         subscription->'keys'->>'p256dh' IS NOT NULL AS sub_has_p256dh,
         subscription->'keys'->>'auth'   IS NOT NULL AS sub_has_auth,
         created_at
  FROM push_subscriptions
  ORDER BY created_at DESC
  LIMIT 3
`);
for (const r of r2.rows) console.dir(r);

console.log('\n=== 제약/인덱스 ===');
const r3 = await client.query(`
  SELECT conname, contype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'push_subscriptions'::regclass
`);
for (const r of r3.rows) console.log(`${r.contype} ${r.conname}: ${r.def}`);

const r4 = await client.query(`
  SELECT indexname, indexdef FROM pg_indexes WHERE tablename='push_subscriptions'
`);
console.log('\n--- indexes ---');
for (const r of r4.rows) console.log(r.indexname, '|', r.indexdef);

console.log('\n=== accounts.id 타입 (참조 호환성 확인) ===');
const r5 = await client.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='accounts' AND column_name='id'
`);
console.dir(r5.rows);

await client.end();
