// departments/ranks + user_* 부속 테이블 8개를 구DB→신DB로 이전
//   - 동적 DDL: information_schema 로 컬럼/PK/FK 도입. FK ref=users → accounts 로 교체.
//   - 데이터 이전: user_id 컬럼은 구 users.id → 신 accounts.id (키 username) 로 remap.
//   - RLS 개방: 모든 신규 테이블 USING(TRUE).
// 실행: node --env-file=.env.local scripts/db-migrate-user-subtables.mjs
import { sourceClient, targetClient } from "./db-conn.mjs";

const TABLES = [
  "departments", "ranks",
  "user_family_members", "user_vehicles", "user_certifications",
  "user_career_history", "user_rewards_punishments", "user_status_history",
];

const src = await sourceClient();
const tgt = await targetClient();

// 1) user_id 리맵 (구 users.id → 신 accounts.id), 키=username = users.name = accounts.username
const oldUsers = (await src.query(`select id, name from users`)).rows;
const newAccs  = (await tgt.query(`select id, username from accounts`)).rows;
const newByUsername = new Map(newAccs.map(a => [a.username, a.id]));
const remap = new Map(); // old.id → new.id
let unmapped = 0;
for (const u of oldUsers) {
  const newId = newByUsername.get(u.name);
  if (newId != null) remap.set(u.id, newId);
  else unmapped++;
}
console.log(`user_id 리맵: ${remap.size}건 매핑, ${unmapped}건 미매핑(accounts에 없음)`);

// 2) 테이블별 처리
async function introspectColumns(c, table) {
  const cols = (await c.query(`
    select column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
    from information_schema.columns
    where table_schema='public' and table_name=$1
    order by ordinal_position`, [table])).rows;
  return cols;
}
async function pkCol(c, table) {
  const r = await c.query(`
    select kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name
    where tc.table_schema='public' and tc.table_name=$1 and tc.constraint_type='PRIMARY KEY'`, [table]);
  return r.rows.map(x => x.column_name);
}
async function fkRefs(c, table) {
  const r = await c.query(`
    select kcu.column_name, ccu.table_name ref_table, ccu.column_name ref_col, rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name
    join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
    where tc.table_schema='public' and tc.table_name=$1 and tc.constraint_type='FOREIGN KEY'`, [table]);
  return r.rows;
}

function colTypeSql(c) {
  // data_type → SQL 타입 문자열
  const dt = c.data_type;
  switch (dt) {
    case "integer": return "integer";
    case "bigint":  return "bigint";
    case "smallint":return "smallint";
    case "boolean": return "boolean";
    case "jsonb":   return "jsonb";
    case "json":    return "json";
    case "text":    return "text";
    case "character varying": return c.character_maximum_length ? `varchar(${c.character_maximum_length})` : "varchar";
    case "numeric": return "numeric";
    case "date":    return "date";
    case "timestamp with time zone": return "timestamptz";
    case "timestamp without time zone": return "timestamp";
    case "ARRAY": return (c.udt_name?.startsWith("_") ? c.udt_name.slice(1) : "text") + "[]";
    case "USER-DEFINED": return c.udt_name; // 도메인/enum
    default: return dt;
  }
}

for (const t of TABLES) {
  console.log(`\n========== ${t} ==========`);
  // 신DB에 이미 있으면 스킵
  const exists = (await tgt.query(`select to_regclass($1) oid`, [`public.${t}`])).rows[0].oid;
  if (exists) {
    console.log(`  (이미 존재 — DDL 스킵, 데이터만 보강)`);
  } else {
    const cols = await introspectColumns(src, t);
    if (cols.length === 0) { console.log("  구DB에 없음 — 스킵"); continue; }
    const pks = await pkCol(src, t);
    const fks = await fkRefs(src, t);
    // CREATE TABLE 본문
    const lines = [];
    for (const c of cols) {
      const def = c.column_default ?? "";
      const isNextval = /nextval\(/i.test(def);
      let typeStr;
      if (isNextval && (c.data_type === "integer" || c.data_type === "bigint" || c.data_type === "smallint")) {
        // SERIAL 계열로 치환 (시퀀스 자동 생성)
        typeStr = c.data_type === "bigint" ? "bigserial" : c.data_type === "smallint" ? "smallserial" : "serial";
      } else {
        typeStr = colTypeSql(c);
      }
      let line = `"${c.column_name}" ${typeStr}`;
      if (!isNextval && def) line += ` DEFAULT ${def}`;
      if (c.is_nullable === "NO" && !typeStr.endsWith("serial")) line += " NOT NULL";
      lines.push(line);
    }
    if (pks.length) lines.push(`PRIMARY KEY (${pks.map(p => `"${p}"`).join(", ")})`);
    for (const fk of fks) {
      const refTable = fk.ref_table === "users" ? "accounts" : fk.ref_table;
      lines.push(`FOREIGN KEY ("${fk.column_name}") REFERENCES "${refTable}"("${fk.ref_col}") ON DELETE ${fk.delete_rule || "NO ACTION"}`);
    }
    const ddl = `CREATE TABLE IF NOT EXISTS public."${t}" (\n  ${lines.join(",\n  ")}\n);`;
    await tgt.query(ddl);
    console.log(`  ✅ 테이블 생성 (FK ${fks.length}개; users→accounts 치환 ${fks.filter(f=>f.ref_table==="users").length}건)`);
  }

  // RLS 개방
  await tgt.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
  await tgt.query(`DROP POLICY IF EXISTS allow_all_${t} ON public."${t}"`);
  await tgt.query(`CREATE POLICY allow_all_${t} ON public."${t}" FOR ALL USING (TRUE) WITH CHECK (TRUE)`);

  // 데이터 이전 (이미 있으면 스킵: id 중복 ON CONFLICT)
  const srcRows = (await src.query(`select * from public."${t}"`)).rows;
  if (srcRows.length === 0) { console.log(`  데이터: 0행 (스킵)`); continue; }

  // 컬럼 목록 (실제 신DB 컬럼만)
  const tgtCols = (await introspectColumns(tgt, t)).map(c => c.column_name);
  const insertCols = Object.keys(srcRows[0]).filter(k => tgtCols.includes(k));

  let inserted = 0, skipped = 0;
  for (const row of srcRows) {
    const vals = insertCols.map(k => {
      let v = row[k];
      // user_id 컬럼은 remap
      if (k === "user_id" && v != null) {
        const mapped = remap.get(v);
        if (mapped == null) return null; // 미매핑은 null (FK 위반 회피)
        return mapped;
      }
      return v;
    });
    // user_id가 null로 떨어진 행은 스킵 (원래 user_id 있었는데 remap 실패)
    const userIdIdx = insertCols.indexOf("user_id");
    if (userIdIdx >= 0 && row.user_id != null && vals[userIdIdx] == null) { skipped++; continue; }

    const placeholders = vals.map((_, i) => `$${i + 1}`);
    const pks = await pkCol(tgt, t);
    const onConflict = pks.length ? `ON CONFLICT (${pks.map(p=>`"${p}"`).join(",")}) DO NOTHING` : "";
    try {
      const r = await tgt.query(
        `INSERT INTO public."${t}"(${insertCols.map(c=>`"${c}"`).join(",")}) VALUES(${placeholders.join(",")}) ${onConflict}`,
        vals
      );
      inserted += r.rowCount;
    } catch (e) {
      skipped++;
      if (skipped <= 2) console.log(`  ⚠️ ${t} 삽입 실패 1건 예시: ${e.message}`);
    }
  }
  // 시퀀스 동기화 (id 컬럼이 있고 serial인 경우)
  if (insertCols.includes("id")) {
    try { await tgt.query(`SELECT setval(pg_get_serial_sequence($1,'id'), COALESCE((SELECT MAX(id) FROM public."${t}"),1))`, [`public.${t}`]); } catch {}
  }
  console.log(`  데이터: ${inserted}건 삽입 / ${skipped}건 스킵 (구DB ${srcRows.length}건)`);
}

console.log("\n=== 신DB 신규 테이블 행수 ===");
for (const t of TABLES) {
  try { const r = await tgt.query(`select count(*)::int n from "${t}"`); console.log(`  ${t.padEnd(28)} ${r.rows[0].n}행`); } catch {}
}

await src.end(); await tgt.end();
