// 로그인 전환용: accounts 인증 관련 데이터/RLS 조사
// 실행: node --env-file=.env.local scripts/inspect-accounts-auth.mjs
import { targetClient } from "./db-conn.mjs";
import { createClient } from "@supabase/supabase-js";

const tgt = await targetClient();

// 1) accounts 샘플 (비밀번호/role/권한 형식 확인)
const sample = await tgt.query(`
  select username, name, role, site_name,
         password, left(password_hash, 16) as pwh16,
         permissions, permission_group_id, dept, status
  from accounts order by id limit 8`);
console.log("=== accounts 샘플 8행 ===");
for (const r of sample.rows) console.log(JSON.stringify(r));

// 2) role 분포
const roles = await tgt.query(`select role, count(*)::int n from accounts group by role order by n desc`);
console.log("\n=== role 분포 ===");
for (const r of roles.rows) console.log(`  ${r.role}: ${r.n}`);

// 3) password / password_hash 채워짐 정도
const pw = await tgt.query(`
  select
    count(*)::int total,
    count(*) filter (where password is not null and password <> '')::int has_password,
    count(*) filter (where password_hash is not null and password_hash <> '')::int has_hash,
    count(*) filter (where permissions is not null)::int has_perms
  from accounts`);
console.log("\n=== 비밀번호/권한 채움 ===", JSON.stringify(pw.rows[0]));

// 4) password 값 형식 (평문 vs 해시) — 길이 분포
const pwlen = await tgt.query(`select length(password) l, count(*)::int n from accounts where password is not null group by l order by n desc limit 5`);
console.log("password 길이 분포:", JSON.stringify(pwlen.rows));

// 5) RLS 정책
const rls = await tgt.query(`
  select c.relname, c.relrowsecurity as rls_on,
    (select count(*) from pg_policies p where p.tablename=c.relname and p.schemaname='public')::int policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('accounts','managed_sites','materials')`);
console.log("\n=== RLS 상태 ===");
for (const r of rls.rows) console.log(`  ${r.relname}: RLS=${r.rls_on} policies=${r.policies}`);
const pols = await tgt.query(`select tablename, policyname, cmd, roles, qual from pg_policies where schemaname='public' and tablename='accounts'`);
console.log("accounts 정책:");
for (const p of pols.rows) console.log(`  ${p.policyname} cmd=${p.cmd} roles=${p.roles} qual=${p.qual}`);

await tgt.end();

// 6) anon key로 accounts 읽기 가능한지 (RLS 실제 영향)
console.log("\n=== anon key 로 accounts 조회 테스트 ===");
const anon = createClient(
  "https://bbnmxwpacdfqvicybhau.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I"
);
const { data, error, count } = await anon.from("accounts").select("username, role", { count: "exact" }).limit(3);
console.log("anon 조회:", { count, error: error?.message, rows: data });
