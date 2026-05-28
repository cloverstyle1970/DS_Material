// 자재관리 흐름 테이블 조사: 존재/행수/FK 구조
// 실행: node --env-file=.env.local scripts/inspect-material-flow.mjs
import { sourceClient, targetClient } from "./db-conn.mjs";
const src = await sourceClient(); const tgt = await targetClient();

const TABLES = ["material_requests","material_units","transactions","purchase_orders","quote_requests","quote_request_items"];

for (const t of TABLES) {
  const oid = (await tgt.query(`select to_regclass('public.${t}') oid`)).rows[0].oid;
  let srcN = "(없음)";
  try { srcN = (await src.query(`select count(*)::int n from "${t}"`)).rows[0].n; } catch {}
  console.log(`\n===== ${t} =====  구DB ${srcN}행 / 신DB ${oid ? "있음" : "없음"}`);
  // 컬럼
  const cols = (await src.query(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).rows;
  if (cols.length === 0) { console.log("  (구DB에 테이블 없음)"); continue; }
  console.log("  컬럼: " + cols.map(c => c.column_name).join(", "));
  // FK
  const fk = (await src.query(`
    select kcu.column_name, ccu.table_name ref, ccu.column_name refcol
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
    where tc.table_name=$1 and tc.constraint_type='FOREIGN KEY'`, [t])).rows;
  console.log("  FK: " + (fk.map(f => `${f.column_name}→${f.ref}.${f.refcol}`).join(", ") || "없음"));
}
await src.end(); await tgt.end();
