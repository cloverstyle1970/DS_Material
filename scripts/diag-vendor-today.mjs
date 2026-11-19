// 마이그레이션 적용 후 확인
import pg from "pg";
const { Client } = pg;

const client = new Client({
  host: "aws-1-ap-northeast-2.pooler.supabase.com",
  port: 5432,
  user: "postgres.bbnmxwpacdfqvicybhau",
  database: "postgres",
  password: process.env.TARGET_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const r = await client.query(`
  SELECT id, created_at AT TIME ZONE 'Asia/Seoul' AS kst_at,
         material_name, note, vendor_name, requester_name
  FROM   transactions
  WHERE  type = '입고'
    AND  vendor_name ILIKE '%준엔지니어링%'
  ORDER BY created_at DESC
  LIMIT  20
`);
console.log(`준엔지니어링 입고건 ${r.rows.length}건:`);
console.table(r.rows.map(x => ({
  id: x.id,
  kst: x.kst_at.toISOString().slice(0,16),
  material: x.material_name.slice(0,25),
  note: x.note?.slice(0,25),
  vendor: x.vendor_name,
  req: x.requester_name,
})));

await client.end();
