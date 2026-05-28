// 구DB users 중 신DB accounts(username)에 없는 사용자 13명을 accounts에 추가
//   - role: permission_group_id=6 → 관리자, 그 외 → 직원
//   - password: "000000" (평문 기본값)
//   - name = username (깔끔하게 일치)
//   - 그 외(dept/rank/ssn/permissions/...): users 에서 복사
//   - '테스트' 계정은 제외
// 실행: node --env-file=.env.local scripts/db-add-missing-accounts.mjs [--apply]
//   --apply 없으면 dry-run (대상자/payload만 출력, 변경 없음)
import { sourceClient, targetClient } from "./db-conn.mjs";

const APPLY = process.argv.includes("--apply");
const DEFAULT_PW = "000000";
const EXCLUDE_NAMES = new Set(["테스트"]);

const src = await sourceClient();
const tgt = await targetClient();
console.log(APPLY ? "🟢 APPLY 모드 — accounts 에 INSERT 실행" : "🟡 DRY-RUN — 변경 없음 (적용: --apply)");

// 1) 대상자 결정
const existing = new Set((await tgt.query(`select username from accounts`)).rows.map(r => r.username));
const userCols = (await src.query(`
  select column_name from information_schema.columns
  where table_schema='public' and table_name='users' order by ordinal_position`)).rows.map(r => r.column_name);
const accCols = new Set((await tgt.query(`
  select column_name from information_schema.columns
  where table_schema='public' and table_name='accounts'`)).rows.map(r => r.column_name));

const allUsers = (await src.query(`select * from users order by name`)).rows;
const candidates = allUsers
  .filter(u => !existing.has(u.name))
  .filter(u => !EXCLUDE_NAMES.has(u.name));

console.log(`\n대상: ${candidates.length}명 (전체 미존재 ${allUsers.filter(u=>!existing.has(u.name)).length}명 중 EXCLUDE ${EXCLUDE_NAMES.size}건 제외)`);

function mapRole(u) {
  const perms = Array.isArray(u.permissions) ? u.permissions : [];
  if (perms.includes("admin")) return "관리자";
  if (u.permission_group_id === 6) return "관리자";
  return "직원";
}

// 2) users → accounts 복사할 컬럼 (두 테이블 모두에 존재하고, accounts 가 자체 처리하는 컬럼 제외)
const SKIP_COPY = new Set([
  "id",                  // bigserial 자동
  "created_at",          // default now()
  "name",                // username 으로 별도 세팅
  "permissions",         // jsonb 별도 처리(스트링화)
]);
const copyCols = userCols.filter(c => accCols.has(c) && !SKIP_COPY.has(c));

// 3) payload 빌드 및 미리보기
const payloads = candidates.map(u => {
  const row = {
    username: u.name,
    password: DEFAULT_PW,
    role: mapRole(u),
    name: u.name,
  };
  for (const c of copyCols) row[c] = u[c];
  // permissions(jsonb)는 객체 그대로 전달 (pg에 stringify 함)
  row.permissions = u.permissions ?? [];
  return row;
});

console.log("\n=== 추가 대상 payload 미리보기 ===");
for (const p of payloads) {
  console.log(`  ${p.username.padEnd(8)} role=${p.role.padEnd(4)} dept=${(p.dept??'-').padEnd(8)} rank=${(p.rank??'-').padEnd(6)} group=${p.permission_group_id ?? '-'} perms=${(p.permissions ?? []).length} pw=${p.password}`);
}

if (!APPLY) {
  console.log(`\n(미적용. --apply 로 실행하면 위 ${payloads.length}명이 accounts 에 추가됩니다)`);
  await src.end(); await tgt.end();
  process.exit(0);
}

// 4) 실행 (트랜잭션)
await tgt.query("BEGIN");
let inserted = 0;
for (const p of payloads) {
  const cols = Object.keys(p);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const vals = cols.map(c => {
    const v = p[c];
    // jsonb 컬럼은 stringify
    if (c === "permissions") return v == null ? null : JSON.stringify(v);
    return v;
  });
  const colList = cols.map(c => `"${c}"`).join(", ");
  const phList = placeholders.map((ph, i) => cols[i] === "permissions" ? `${ph}::jsonb` : ph).join(", ");
  await tgt.query(`INSERT INTO public."accounts"(${colList}) VALUES(${phList})`, vals);
  inserted++;
}
await tgt.query("COMMIT");
console.log(`\n✅ ${inserted}명 accounts 에 추가 완료`);

// 5) 검증
const after = await tgt.query(`select count(*)::int n from accounts`);
console.log(`accounts 총 행수: ${after.rows[0].n}`);

await src.end(); await tgt.end();
