// 병합 매칭 키/중복/커버리지 조사 (읽기 전용)
// 실행: node --env-file=.env.local scripts/db-merge-inspect.mjs
import { sourceClient, targetClient } from "./db-conn.mjs";

const src = await sourceClient();
const tgt = await targetClient();

// ── 신DB 'users'가 어느 스키마에 있는지 (auth.users 인지 확인) ──
const us = await tgt.query(`select table_schema from information_schema.tables where table_name='users'`);
console.log("신DB의 'users' 테이블 스키마:", us.rows.map(r => r.table_schema).join(", ") || "(없음)");

// ── accounts ↔ users 매칭 ──
const acc = (await tgt.query(`select username, name, role, site_name from accounts`)).rows;
const usr = (await src.query(`select name from users`)).rows.map(r => r.name);
const usrSet = new Set(usr);
console.log(`\n[accounts ${acc.length}행 / 구DB.users ${usr.length}행]`);
console.log("accounts 샘플 5행:");
for (const a of acc.slice(0, 5)) console.log("   ", JSON.stringify(a));
const matchByUsername = acc.filter(a => usrSet.has(a.username)).length;
const matchByName = acc.filter(a => a.name && usrSet.has(a.name)).length;
console.log(`accounts.username 이 users.name 과 일치: ${matchByUsername}/${acc.length}`);
console.log(`accounts.name     이 users.name 과 일치: ${matchByName}/${acc.length}`);
const dupUsername = acc.length - new Set(acc.map(a => a.username)).size;
console.log(`accounts.username 중복: ${dupUsername}건`);
// 구DB users.name 중복
const dupUserName = usr.length - new Set(usr).size;
console.log(`구DB users.name 중복: ${dupUserName}건`);
console.log(`'황진한' → accounts.username 존재: ${acc.some(a=>a.username==='황진한')}, accounts.name 존재: ${acc.some(a=>a.name==='황진한')}, users.name 존재: ${usrSet.has('황진한')}`);

// ── managed_sites ↔ sites 매칭 ──
const ms = (await tgt.query(`select id, site_name, elevator_number from managed_sites`)).rows;
const st = (await src.query(`select name from sites`)).rows.map(r => r.name);
const stSet = new Set(st);
console.log(`\n[managed_sites ${ms.length}행 / 구DB.sites ${st.length}행]`);
console.log("managed_sites 샘플 5행:");
for (const m of ms.slice(0, 5)) console.log("   ", JSON.stringify(m));
const msNames = ms.map(m => m.site_name);
const msDistinct = new Set(msNames).size;
console.log(`managed_sites.site_name distinct: ${msDistinct} (전체 ${ms.length}) → 현장명 중복행: ${ms.length - msDistinct}건`);
const stDistinct = new Set(st).size;
console.log(`구DB sites.name distinct: ${stDistinct} (전체 ${st.length}) → 중복: ${st.length - stDistinct}건`);
const msMatch = ms.filter(m => stSet.has(m.site_name)).length;
console.log(`managed_sites.site_name 이 sites.name 과 일치: ${msMatch}/${ms.length}`);
// managed_sites 중 현장명이 여러 행인 사례 top5
const cnt = {};
for (const n of msNames) cnt[n] = (cnt[n]||0)+1;
const dups = Object.entries(cnt).filter(([,c])=>c>1).sort((a,b)=>b[1]-a[1]).slice(0,5);
console.log("managed_sites 현장명 다중행 top5:", JSON.stringify(dups));

await src.end(); await tgt.end();
