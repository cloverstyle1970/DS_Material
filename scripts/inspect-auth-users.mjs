// auth.users 와 accounts 매칭 확인
// 실행: node --env-file=.env.local scripts/inspect-auth-users.mjs
import { targetClient } from "./db-conn.mjs";

const c = await targetClient();

const cnt = await c.query(`select count(*)::int n from auth.users`);
console.log("auth.users 행수:", cnt.rows[0].n);

const s = await c.query(`
  select email,
         (encrypted_password is not null and encrypted_password <> '') as has_pw,
         created_at::date as created
  from auth.users order by created_at limit 8`);
console.log("auth.users 샘플:");
for (const r of s.rows) console.log("  ", JSON.stringify(r));

const m = await c.query(`
  select count(*)::int matched
  from accounts a
  where (a.username || '@daesol.com') in (select email from auth.users)`);
console.log("accounts.username@daesol.com ↔ auth.email 매칭:", m.rows[0].matched, "/ 46");

// auth email 도메인 분포
const dom = await c.query(`
  select split_part(email,'@',2) dom, count(*)::int n from auth.users group by dom order by n desc limit 5`);
console.log("auth email 도메인:", JSON.stringify(dom.rows));

await c.end();
