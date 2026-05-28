import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE = createClient(
  "https://gwgzzsoknjulwwsmubju.supabase.co",
  "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ"
);
const TARGET = createClient(
  "https://bbnmxwpacdfqvicybhau.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I"
);

// src 전체에서 supabase.from("table") 테이블명 추출
function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e)) acc.push(p);
  }
  return acc;
}
const tables = new Set();
const re = /\.from\(\s*["'`]([a-z_]+)["'`]/g;
for (const f of walk("src")) {
  const txt = readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(txt))) tables.add(m[1]);
}
const TABLES = [...tables].sort();
console.log(`코드가 참조하는 테이블 ${TABLES.length}개\n`);

async function exists(client, t) {
  const { error } = await client.from(t).select("*").limit(1);
  return !error; // PGRST205 등 에러면 없음
}

const rows = [];
for (const t of TABLES) {
  const [s, g] = await Promise.all([exists(SOURCE, t), exists(TARGET, t)]);
  rows.push({ t, s, g });
}

console.log("테이블".padEnd(28), "구DB", " 신DB");
console.log("-".repeat(45));
for (const { t, s, g } of rows) {
  console.log(t.padEnd(28), (s ? "✅" : "❌").padEnd(5), g ? "✅" : "❌");
}

const missing = rows.filter(r => !r.g).map(r => r.t);
console.log(`\n신DB 누락 테이블 ${missing.length}개:`);
console.log(missing.join("\n"));
