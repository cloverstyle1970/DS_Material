// site_elevators.emergency_phone이 비어 있는 호기 중,
// managed_sites.emergency_devices(jsonb) 안에 같은 site_id + (installation_place|unit_name) 매칭되는
// slot=1 항목이 있는 경우 emergency_phone을 그 값으로 보강한다.
//
// 정책: 엑셀(2026-06-04)이 정본 → 이미 채워진 1,660건은 절대 덮어쓰지 않는다.
//       빈 칸만 보강. unit="" (현장공통), slot>=2, 매칭 안 되는 unit은 건너뜀.
//
// 사용:  TARGET_DB_PASSWORD=... node scripts/backfill-emergency-phone-from-devices.mjs

import pg from "pg";
const { Client } = pg;

const c = new Client({
  host: "aws-1-ap-northeast-2.pooler.supabase.com",
  port: 5432,
  user: "postgres.bbnmxwpacdfqvicybhau",
  database: "postgres",
  password: process.env.TARGET_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const before = await c.query(`
  select count(*) filter (where emergency_phone is null or emergency_phone = '')::int as empty
  from public.site_elevators
`);
console.log(`보강 전 빈 emergency_phone: ${before.rows[0].empty}건`);

const res = await c.query(`
  with devices as (
    select ms.id as site_id, elem->>'unit' as unit, elem->>'number' as number
    from public.managed_sites ms, jsonb_array_elements(ms.emergency_devices) elem
    where ms.emergency_devices is not null
      and coalesce(elem->>'unit', '') <> ''
      and (elem->>'slot')::int = 1
      and coalesce(elem->>'number', '') <> ''
  )
  update public.site_elevators se
     set emergency_phone = d.number
    from devices d
   where se.site_id = d.site_id
     and (se.installation_place = d.unit or se.unit_name = d.unit)
     and (se.emergency_phone is null or se.emergency_phone = '')
`);
console.log(`✓ 보강 적용 행: ${res.rowCount}`);

const after = await c.query(`
  select count(*) filter (where emergency_phone is null or emergency_phone = '')::int as empty
  from public.site_elevators
`);
console.log(`보강 후 빈 emergency_phone: ${after.rows[0].empty}건 (= 마이그레이션 불가, 수동 입력 필요)`);

await c.end();
