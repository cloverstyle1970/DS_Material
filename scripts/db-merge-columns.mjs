// 구DB 컬럼을 신DB로 병합 (가산적, 재실행 안전)
//   1) accounts   ← users  : 키 accounts.username = users.name
//   2) managed_sites ← sites: 키 managed_sites.site_name = sites.name
// 소스에만 있는 컬럼을 타깃에 ADD COLUMN 후, 키 조인으로 값 복사.
// 실행: node --env-file=.env.local scripts/db-merge-columns.mjs [--apply]
//   --apply 없으면 dry-run(추가할 컬럼/매칭수만 출력, 변경 없음)
import { sourceClient, targetClient } from "./db-conn.mjs";

const APPLY = process.argv.includes("--apply");

const MERGES = [
  { srcTable: "users", srcKey: "name",  tgtTable: "accounts",      tgtKey: "username" },
  { srcTable: "sites", srcKey: "name",  tgtTable: "managed_sites", tgtKey: "site_name" },
];

async function colTypes(c, table) {
  const { rows } = await c.query(`
    select column_name, data_type, udt_name
    from information_schema.columns
    where table_schema='public' and table_name=$1`, [table]);
  const m = new Map();
  for (const r of rows) m.set(r.column_name, r);
  return m;
}

// information_schema data_type → ALTER 용 타입 문자열
function sqlType(info) {
  switch (info.data_type) {
    case "jsonb": return "jsonb";
    case "json": return "json";
    case "integer": return "integer";
    case "bigint": return "bigint";
    case "boolean": return "boolean";
    case "numeric": return "numeric";
    case "timestamp with time zone": return "timestamptz";
    case "timestamp without time zone": return "timestamp";
    case "date": return "date";
    default: return "text";
  }
}

const src = await sourceClient();
const tgt = await targetClient();
console.log(APPLY ? "🟢 APPLY 모드 — 실제 변경" : "🟡 DRY-RUN — 변경 없음 (적용하려면 --apply)");

for (const mg of MERGES) {
  console.log(`\n========== ${mg.tgtTable} ← ${mg.srcTable} (키: ${mg.tgtTable}.${mg.tgtKey} = ${mg.srcTable}.${mg.srcKey}) ==========`);
  const srcCols = await colTypes(src, mg.srcTable);
  const tgtCols = await colTypes(tgt, mg.tgtTable);

  // 소스에만 있는 컬럼 (키/ id / created_at 제외)
  const skip = new Set([mg.srcKey, "id", "created_at"]);
  const missing = [...srcCols.keys()].filter(c => !tgtCols.has(c) && !skip.has(c));
  console.log(`추가할 컬럼 ${missing.length}개:`);
  for (const c of missing) console.log(`   + ${c.padEnd(24)} ${sqlType(srcCols.get(c))}`);

  if (APPLY) {
    for (const c of missing) {
      await tgt.query(`ALTER TABLE public."${mg.tgtTable}" ADD COLUMN IF NOT EXISTS "${c}" ${sqlType(srcCols.get(c))}`);
    }
    console.log("   → 컬럼 추가 완료");
  }

  // 값 복사: 소스 전체 읽어 키로 UPDATE
  const cols = [mg.srcKey, ...missing];
  const selectList = cols.map(c => `"${c}"`).join(", ");
  const srcRows = (await src.query(`select ${selectList} from public."${mg.srcTable}"`)).rows;

  // 타깃 키 집합 (매칭 커버리지 측정)
  const tgtKeys = new Set((await tgt.query(`select "${mg.tgtKey}" k from public."${mg.tgtTable}"`)).rows.map(r => r.k));
  const matched = srcRows.filter(r => tgtKeys.has(r[mg.srcKey]));
  console.log(`소스 ${srcRows.length}행 중 타깃 키와 매칭: ${matched.length}행 (미매칭 ${srcRows.length - matched.length})`);

  if (APPLY) {
    await tgt.query("BEGIN");
    let updated = 0;
    for (const row of matched) {
      const sets = [];
      const vals = [];
      let i = 1;
      for (const c of missing) {
        const info = srcCols.get(c);
        let v = row[c];
        if (info.data_type === "jsonb" || info.data_type === "json") {
          v = v == null ? null : JSON.stringify(v);
          sets.push(`"${c}" = $${i}::jsonb`);
        } else {
          sets.push(`"${c}" = $${i}`);
        }
        vals.push(v);
        i++;
      }
      vals.push(row[mg.srcKey]);
      const res = await tgt.query(
        `UPDATE public."${mg.tgtTable}" SET ${sets.join(", ")} WHERE "${mg.tgtKey}" = $${i}`,
        vals
      );
      updated += res.rowCount;
    }
    await tgt.query("COMMIT");
    console.log(`   → ${updated}행 값 복사 완료`);
  }
}

await src.end(); await tgt.end();
console.log(APPLY ? "\n✅ 병합 완료" : "\n(미적용. node --env-file=.env.local scripts/db-merge-columns.mjs --apply 로 실행)");
