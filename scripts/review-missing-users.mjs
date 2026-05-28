// 구DB users 중 신DB accounts(username)에 없는 사용자 추가 가능성 검토 (읽기 전용)
// 실행: node --env-file=.env.local scripts/review-missing-users.mjs
import { sourceClient, targetClient } from "./db-conn.mjs";

const src = await sourceClient();
const tgt = await targetClient();

// accounts.username 집합
const accUsernames = new Set((await tgt.query(`select username from accounts`)).rows.map(r => r.username));

// 구DB users 전체
const users = (await src.query(`
  select name, dept, rank, status, hire_date, resign_date,
         (permissions @> '["admin"]'::jsonb) as is_admin,
         coalesce(jsonb_array_length(permissions), 0) as perm_cnt,
         (password_hash is not null and password_hash <> '') as has_hash
  from users order by name`)).rows;

const missing = users.filter(u => !accUsernames.has(u.name));
console.log(`구DB users ${users.length}명 / accounts.username 매칭 ${users.length - missing.length}명`);
console.log(`\n=== accounts 에 없는 사용자 ${missing.length}명 ===`);
for (const u of missing) {
  console.log(`  ${(u.name||'').padEnd(10)} 부서=${(u.dept||'-').padEnd(8)} 직급=${(u.rank||'-').padEnd(6)} 상태=${(u.status||'-').padEnd(6)} 권한=${u.is_admin?'admin':u.perm_cnt+'개'} 해시=${u.has_hash?'O':'X'} 입사=${u.hire_date||'-'} 퇴사=${u.resign_date||'-'}`);
}

// 상태 분포
const byStatus = {};
for (const u of missing) byStatus[u.status||'(없음)'] = (byStatus[u.status||'(없음)']||0)+1;
console.log("\n미존재자 상태 분포:", JSON.stringify(byStatus));

// 이름 중복(추가 시 username 충돌 가능성) — 미존재자끼리 동명이인
const nameCount = {};
for (const u of missing) nameCount[u.name] = (nameCount[u.name]||0)+1;
const dupNames = Object.entries(nameCount).filter(([,c])=>c>1);
console.log("미존재자 중 동명이인:", dupNames.length ? JSON.stringify(dupNames) : "없음");

// accounts NOT NULL 제약 + 기본값
const cons = await tgt.query(`
  select column_name, is_nullable, column_default
  from information_schema.columns
  where table_schema='public' and table_name='accounts' and is_nullable='NO'
  order by ordinal_position`);
console.log("\n=== accounts NOT NULL 컬럼 (삽입 시 값 필요) ===");
for (const c of cons.rows) console.log(`  ${c.column_name.padEnd(14)} default=${c.column_default ?? '(없음 → 직접 제공 필요)'}`);

await src.end(); await tgt.end();
