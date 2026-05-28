// 산업안전(TBM + 근무복·안전장구) 14개 테이블을 구DB→신DB 이전
//   - 의존성 순서 생성. FK ref=users→accounts. 대상에 없는 ref 테이블(construction_schedules 등)은 FK 생략(컬럼만 보존).
//   - user_id 컬럼 remap (구 users.id → 신 accounts.id, 키 username)
//   - jsonb stringify, RLS 개방
// 실행: node --env-file=.env.local scripts/db-migrate-safety.mjs
import { sourceClient, targetClient } from "./db-conn.mjs";

const src = await sourceClient();
const tgt = await targetClient();

const PLAN = [
  { t: "tbm_checklist_items",        userCols: [] },
  { t: "tbm_fault_types",            userCols: [] },
  { t: "tbm_repair_types",           userCols: [] },
  { t: "tbm_safety_rules_master",    userCols: [] },
  { t: "tbm_records",                userCols: ["user_id"] },
  { t: "tbm_participants",           userCols: ["user_id"] },
  { t: "tbm_photos",                 userCols: [] },
  { t: "tbm_participant_photos",     userCols: ["user_id"] },
  { t: "tbm_participant_checklist",  userCols: ["user_id"] },
  { t: "tbm_participant_safety",     userCols: ["user_id"] },
  { t: "tbm_checklist_results",      userCols: [] },
  { t: "tbm_record_safety_rules",    userCols: [] },
  { t: "uniform_safety_requests",    userCols: ["user_id"] },
  { t: "uniform_safety_request_items", userCols: [] },
];

const newByUsername = new Map((await tgt.query(`select id, username from accounts`)).rows.map(a => [a.username, a.id]));
const remap = new Map();
for (const u of (await src.query(`select id, name from users`)).rows) { const n = newByUsername.get(u.name); if (n != null) remap.set(u.id, n); }
console.log(`user_id 리맵: ${remap.size}건`);

function colTypeSql(c) {
  switch (c.data_type) {
    case "integer": return "integer"; case "bigint": return "bigint"; case "smallint": return "smallint";
    case "boolean": return "boolean"; case "jsonb": return "jsonb"; case "json": return "json";
    case "numeric": return "numeric"; case "date": return "date";
    case "timestamp with time zone": return "timestamptz"; case "timestamp without time zone": return "timestamp";
    case "ARRAY": return (c.udt_name?.startsWith("_") ? c.udt_name.slice(1) : "text") + "[]";
    default: return "text";
  }
}
const colsOf = async (c, t) => (await c.query(`select column_name, data_type, udt_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).rows;
const pkOf = async (c, t) => (await c.query(`select kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name where tc.table_name=$1 and tc.constraint_type='PRIMARY KEY'`, [t])).rows.map(r => r.column_name);
const fkOf = async (c, t) => (await c.query(`select kcu.column_name, ccu.table_name ref_table, ccu.column_name ref_col, rc.delete_rule from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name where tc.table_name=$1 and tc.constraint_type='FOREIGN KEY'`, [t])).rows;
const tgtHas = async (t) => !!(await tgt.query(`select to_regclass($1) oid`, [`public.${t}`])).rows[0].oid;

for (const { t, userCols } of PLAN) {
  console.log(`\n===== ${t} =====`);
  const scols = await colsOf(src, t);
  if (!(await tgtHas(t))) {
    const pks = await pkOf(src, t);
    const fkRows = await fkOf(src, t);
    const lines = [];
    for (const c of scols) {
      const def = c.column_default ?? ""; const isSeq = /nextval\(/i.test(def);
      const typeStr = (isSeq && ["integer","bigint","smallint"].includes(c.data_type))
        ? (c.data_type === "bigint" ? "bigserial" : c.data_type === "smallint" ? "smallserial" : "serial") : colTypeSql(c);
      let line = `"${c.column_name}" ${typeStr}`;
      if (!isSeq && def) line += ` DEFAULT ${def}`;
      if (c.is_nullable === "NO" && !typeStr.endsWith("serial")) line += " NOT NULL";
      lines.push(line);
    }
    if (pks.length) lines.push(`PRIMARY KEY (${pks.map(p => `"${p}"`).join(", ")})`);
    let skipped = 0;
    for (const fk of fkRows) {
      const ref = fk.ref_table === "users" ? "accounts" : fk.ref_table;
      if (!(await tgtHas(ref))) { skipped++; continue; } // 대상에 없는 참조 테이블 → FK 생략(컬럼만 유지)
      lines.push(`FOREIGN KEY ("${fk.column_name}") REFERENCES "${ref}"("${fk.ref_col}") ON DELETE ${fk.delete_rule || "NO ACTION"}`);
    }
    await tgt.query(`CREATE TABLE IF NOT EXISTS public."${t}" (\n  ${lines.join(",\n  ")}\n)`);
    console.log(`  ✅ 생성 (FK ${fkRows.length - skipped}/${fkRows.length}; 생략 ${skipped})`);
  } else console.log("  (이미 존재)");

  await tgt.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
  await tgt.query(`DROP POLICY IF EXISTS allow_all_${t} ON public."${t}"`);
  await tgt.query(`CREATE POLICY allow_all_${t} ON public."${t}" FOR ALL USING (TRUE) WITH CHECK (TRUE)`);

  const rows = (await src.query(`select * from public."${t}"`)).rows;
  if (rows.length === 0) { console.log("  데이터 0행"); continue; }
  const jsonbCols = new Set(scols.filter(c => ["jsonb","json"].includes(c.data_type)).map(c => c.column_name));
  const colNames = scols.map(c => c.column_name);
  const pks = await pkOf(tgt, t);
  let inserted = 0, remapped = 0;
  for (const row of rows) {
    const vals = colNames.map(c => {
      let v = row[c];
      if (userCols.includes(c) && v != null) { const m = remap.get(v); if (m != null) { if (m !== v) remapped++; return m; } return null; }
      if (jsonbCols.has(c)) return v == null ? null : JSON.stringify(v);
      return v;
    });
    const ph = colNames.map((c, i) => jsonbCols.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`);
    const onConf = pks.length ? `ON CONFLICT (${pks.map(p => `"${p}"`).join(",")}) DO NOTHING` : "";
    try { const r = await tgt.query(`INSERT INTO public."${t}"(${colNames.map(c => `"${c}"`).join(",")}) VALUES(${ph.join(",")}) ${onConf}`, vals); inserted += r.rowCount; }
    catch (e) { console.log(`  ⚠️ ${e.message}`); }
  }
  if (colNames.includes("id")) { try { await tgt.query(`SELECT setval(pg_get_serial_sequence($1,'id'), COALESCE((SELECT MAX(id) FROM public."${t}"),1))`, [`public.${t}`]); } catch {} }
  console.log(`  데이터 ${inserted}/${rows.length}행 (user_id 리맵 ${remapped})`);
}
await src.end(); await tgt.end();
console.log("\n✅ 산업안전 테이블 이전 완료");
