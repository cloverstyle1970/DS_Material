// notifications 테이블 생성 검증
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

const q = async (label, sql) => {
  try { const r = await client.query(sql); console.log(`✓ ${label}:`); for (const row of r.rows) console.log('  ', row); }
  catch (e) { console.log(`✗ ${label}: ${e.message}`); }
};

await q('테이블 존재',
  `SELECT to_regclass('public.notifications') AS exists`);
await q('컬럼 목록',
  `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' ORDER BY ordinal_position`);
await q('FK 제약 (accounts 참조 확인)',
  `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.notifications'::regclass AND contype='f'`);
await q('인덱스',
  `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='notifications'`);
await q('RLS 정책',
  `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename='notifications'`);
await q('테스트 INSERT (박은숙 id=11)',
  `INSERT INTO notifications(user_id, type, title, message, link)
   VALUES (11, 'verify', '검증 알림', '인앱 알림 검증용 — 자동 삭제됨', '/me')
   RETURNING id, user_id, type, title, created_at`);
await q('박은숙 알림 조회',
  `SELECT id, type, title, is_read FROM notifications WHERE user_id=11 ORDER BY created_at DESC LIMIT 5`);
await q('테스트 행 정리',
  `DELETE FROM notifications WHERE type='verify' RETURNING id`);

await client.end();
