// 구DB ↔ 신DB 스키마 정밀 분석
// 실행: node --env-file=.env.local scripts/db-introspect.mjs
import { sourceClient, targetClient } from "./db-conn.mjs";

async function tableList(c) {
  const { rows } = await c.query(`
    select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE'
    order by table_name`);
  return rows.map(r => r.table_name);
}
async function columns(c, t) {
  const { rows } = await c.query(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema='public' and table_name=$1
    order by ordinal_position`, [t]);
  return rows;
}
async function count(c, t) {
  try { const { rows } = await c.query(`select count(*)::int n from "${t}"`); return rows[0].n; }
  catch { return "(없음)"; }
}
function printCols(title, cols) {
  console.log(`\n── ${title} (${cols.length} cols) ──`);
  for (const r of cols)
    console.log(`   ${r.column_name.padEnd(26)} ${r.data_type.padEnd(24)} ${r.is_nullable === "NO" ? "NOT NULL" : ""} ${r.column_default ? "DEF " + r.column_default.slice(0, 30) : ""}`);
}

const src = await sourceClient();
const tgt = await targetClient();
console.log("✅ 양 DB 접속 OK");

const srcTables = await tableList(src);
const tgtTables = await tableList(tgt);
console.log(`\n구DB 테이블 ${srcTables.length}개 / 신DB 테이블 ${tgtTables.length}개`);
const onlyInSrc = srcTables.filter(t => !tgtTables.includes(t));
const onlyInTgt = tgtTables.filter(t => !srcTables.includes(t));
const inBoth = srcTables.filter(t => tgtTables.includes(t));
console.log(`\n[구DB에만 — 신DB로 이전 필요] ${onlyInSrc.length}개:\n  ${onlyInSrc.join(", ")}`);
console.log(`\n[신DB에만] ${onlyInTgt.length}개:\n  ${onlyInTgt.join(", ")}`);
console.log(`\n[양쪽 공통] ${inBoth.length}개:\n  ${inBoth.join(", ")}`);

printCols("구DB.users", await columns(src, "users"));
printCols("신DB.accounts", await columns(tgt, "accounts"));
if (tgtTables.includes("users")) printCols("신DB.users", await columns(tgt, "users"));
printCols("구DB.sites", await columns(src, "sites"));
printCols("신DB.managed_sites", await columns(tgt, "managed_sites"));

console.log("\n── 행수 ──");
for (const [c, label, t] of [
  [src, "구DB.users", "users"], [tgt, "신DB.accounts", "accounts"], [tgt, "신DB.users", "users"],
  [src, "구DB.sites", "sites"], [tgt, "신DB.managed_sites", "managed_sites"],
]) console.log(`   ${label.padEnd(20)} ${await count(c, t)}`);

await src.end(); await tgt.end();
