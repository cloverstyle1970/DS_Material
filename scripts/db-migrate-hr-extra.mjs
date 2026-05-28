// HR 추가 테이블: crews, vehicle_user_history, vehicle_insurance_history
// 실행: node --env-file=.env.local scripts/db-migrate-hr-extra.mjs
import { sourceClient, targetClient } from "./db-conn.mjs";
const src = await sourceClient(); const tgt = await targetClient();
const PLAN = ["crews", "vehicle_user_history", "vehicle_insurance_history"];
const colTypeSql = (c) => ({ integer:"integer", bigint:"bigint", smallint:"smallint", boolean:"boolean", jsonb:"jsonb", json:"json", numeric:"numeric", date:"date", "timestamp with time zone":"timestamptz", "timestamp without time zone":"timestamp" }[c.data_type] ?? (c.data_type === "ARRAY" ? ((c.udt_name?.startsWith("_") ? c.udt_name.slice(1) : "text") + "[]") : "text"));
const colsOf = async (c,t) => (await c.query(`select column_name,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,[t])).rows;
const pkOf = async (c,t) => (await c.query(`select kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name where tc.table_name=$1 and tc.constraint_type='PRIMARY KEY'`,[t])).rows.map(r=>r.column_name);
const fkOf = async (c,t) => (await c.query(`select kcu.column_name,ccu.table_name ref_table,ccu.column_name ref_col,rc.delete_rule from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name where tc.table_name=$1 and tc.constraint_type='FOREIGN KEY'`,[t])).rows;
const tgtHas = async (t) => !!(await tgt.query(`select to_regclass($1) oid`,[`public.${t}`])).rows[0].oid;
for (const t of PLAN) {
  console.log(`\n== ${t} ==`);
  const scols = await colsOf(src,t);
  if (!(await tgtHas(t))) {
    const pks = await pkOf(src,t), fks = await fkOf(src,t), lines = [];
    for (const c of scols) { const def=c.column_default??""; const seq=/nextval\(/i.test(def); const ty=(seq&&["integer","bigint","smallint"].includes(c.data_type))?(c.data_type==="bigint"?"bigserial":c.data_type==="smallint"?"smallserial":"serial"):colTypeSql(c); let l=`"${c.column_name}" ${ty}`; if(!seq&&def)l+=` DEFAULT ${def}`; if(c.is_nullable==="NO"&&!ty.endsWith("serial"))l+=" NOT NULL"; lines.push(l); }
    if (pks.length) lines.push(`PRIMARY KEY (${pks.map(p=>`"${p}"`).join(",")})`);
    for (const fk of fks) { const ref=fk.ref_table==="users"?"accounts":fk.ref_table; if(!(await tgtHas(ref)))continue; lines.push(`FOREIGN KEY ("${fk.column_name}") REFERENCES "${ref}"("${fk.ref_col}") ON DELETE ${fk.delete_rule||"NO ACTION"}`); }
    await tgt.query(`CREATE TABLE IF NOT EXISTS public."${t}" (\n  ${lines.join(",\n  ")}\n)`); console.log("  ✅ 생성");
  } else console.log("  (이미 존재)");
  await tgt.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
  await tgt.query(`DROP POLICY IF EXISTS allow_all_${t} ON public."${t}"`);
  await tgt.query(`CREATE POLICY allow_all_${t} ON public."${t}" FOR ALL USING (TRUE) WITH CHECK (TRUE)`);
  const rows = (await src.query(`select * from public."${t}"`)).rows;
  if (!rows.length) { console.log("  데이터 0행"); continue; }
  const jb = new Set(scols.filter(c=>["jsonb","json"].includes(c.data_type)).map(c=>c.column_name));
  const cn = scols.map(c=>c.column_name); const pks = await pkOf(tgt,t); let ins=0;
  for (const row of rows) { const vals=cn.map(c=>jb.has(c)?(row[c]==null?null:JSON.stringify(row[c])):row[c]); const ph=cn.map((c,i)=>jb.has(c)?`$${i+1}::jsonb`:`$${i+1}`); const oc=pks.length?`ON CONFLICT (${pks.map(p=>`"${p}"`).join(",")}) DO NOTHING`:""; try{const r=await tgt.query(`INSERT INTO public."${t}"(${cn.map(c=>`"${c}"`).join(",")}) VALUES(${ph.join(",")}) ${oc}`,vals);ins+=r.rowCount;}catch(e){console.log("  ⚠️",e.message);} }
  if (cn.includes("id")) { try { await tgt.query(`SELECT setval(pg_get_serial_sequence($1,'id'),COALESCE((SELECT MAX(id) FROM public."${t}"),1))`,[`public.${t}`]); } catch {} }
  console.log(`  데이터 ${ins}/${rows.length}행`);
}
await src.end(); await tgt.end(); console.log("\n✅ HR 추가 테이블 완료");
