// site_elevators ↔ managed_sites 정합성/매핑 확인
// 실행: node --env-file=.env.local scripts/inspect-site-elevators.mjs
import { targetClient } from "./db-conn.mjs";
const c = await targetClient();

// FK 존재 여부
const fk = await c.query(`
  select tc.constraint_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_col
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name
  join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
  where tc.constraint_type='FOREIGN KEY' and tc.table_name='site_elevators'`);
console.log("site_elevators FK:", fk.rows.length ? JSON.stringify(fk.rows) : "(없음 — PostgREST 임베드 불가)");

// 조인 샘플
const j = await c.query(`
  select se.id, se.site_id, ms.site_name, se.unit_name, se.elevator_number, se.elevator_model
  from site_elevators se left join managed_sites ms on ms.id = se.site_id
  order by se.id limit 6`);
console.log("\n조인 샘플:");
for (const r of j.rows) console.log("  ", JSON.stringify(r));

// site_id 가 managed_sites 에 매칭 안 되는 고아 행
const orphan = await c.query(`select count(*)::int n from site_elevators se where not exists (select 1 from managed_sites ms where ms.id=se.site_id)`);
console.log("\n고아(매칭 안 되는 site_id) 행수:", orphan.rows[0].n, "/ 2343");

// 현장당 호기수 분포 top
const per = await c.query(`select count(*)::int elevators_per_site, count(*) over() from (select site_id, count(*) c from site_elevators group by site_id) t group by 1`).catch(()=>({rows:[]}));
const persite = await c.query(`select se.site_id, ms.site_name, count(*)::int n from site_elevators se left join managed_sites ms on ms.id=se.site_id group by se.site_id, ms.site_name order by n desc limit 3`);
console.log("현장당 호기수 top3:", JSON.stringify(persite.rows));

await c.end();
