// site_elevators.emergency_phone 컬럼 신설 + 엑셀 데이터로 호기별 업데이트.
//
// 매칭 키: site_elevators.id ↔ 엑셀 id  (사용자 요청은 elevator_number 기준이나,
//   같은 elevator_number 를 가진 호기가 1건 있어 id 로 매칭해야 정확. elevator_number
//   매칭 가능성은 1659/1659 = 100% 로 사전 검증됨.)
//
// 사용:  TARGET_DB_PASSWORD=... node scripts/update-site-elevators-emergency-phone.mjs

import pg from "pg";
import XLSX from "xlsx";
const { Client } = pg;

const XLSX_PATH = "C:/Users/황진한/Downloads/site_elevators_260604.xlsx";

const c = new Client({
  host: "aws-1-ap-northeast-2.pooler.supabase.com",
  port: 5432,
  user: "postgres.bbnmxwpacdfqvicybhau",
  database: "postgres",
  password: process.env.TARGET_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// 1) 컬럼 신설 (idempotent)
await c.query(`alter table public.site_elevators add column if not exists emergency_phone text`);
console.log("✓ site_elevators.emergency_phone 컬럼 확보");

// 2) 엑셀 로드 → id 기준으로 (id, emergency_phone) 페어 추출 (값 있는 것만)
const wb = XLSX.readFile(XLSX_PATH);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
const pairs = rows
  .filter(r => r.id != null && r.emergency_phone != null && String(r.emergency_phone).trim() !== "")
  .map(r => ({ id: Number(r.id), emergency_phone: String(r.emergency_phone).trim() }));
console.log(`업데이트 페어: ${pairs.length}건`);

// 3) 일괄 UPDATE — unnest 패턴으로 단일 쿼리
const ids = pairs.map(p => p.id);
const phones = pairs.map(p => p.emergency_phone);
const res = await c.query(
  `update public.site_elevators se
     set emergency_phone = v.phone
     from (select unnest($1::bigint[]) as id, unnest($2::text[]) as phone) v
    where se.id = v.id`,
  [ids, phones]
);
console.log(`✓ UPDATE 반영 행: ${res.rowCount}`);

// 4) 검증: 채워진 비율, 엑셀 빈 칸은 그대로 NULL
const verify = await c.query(`
  select
    count(*)::int as total,
    count(*) filter (where emergency_phone is not null and emergency_phone <> '')::int as filled
  from public.site_elevators
`);
console.log(`\n--- 검증 ---`);
console.log(`site_elevators 총 ${verify.rows[0].total}건, emergency_phone 채워짐 ${verify.rows[0].filled}건`);

// 5) 충돌 케이스(2294134) 두 행이 다른 값 들어갔는지 확인
const conflictCheck = await c.query(`
  select id, elevator_number, emergency_phone
  from public.site_elevators
  where elevator_number = '2294134'
  order by id
`);
console.log("\n--- elevator_number=2294134 두 행 ---");
console.log(JSON.stringify(conflictCheck.rows, null, 2));

// 6) 임의 샘플
const sample = await c.query(`
  select id, elevator_number, emergency_phone
  from public.site_elevators
  where emergency_phone is not null
  order by id desc limit 5
`);
console.log("\n--- 샘플 5건 ---");
console.log(JSON.stringify(sample.rows, null, 2));

await c.end();
