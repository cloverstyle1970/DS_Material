// supabase.ts 의 degrade 래퍼 로직 검증 (신DB anon key 사용)
import { createClient } from "@supabase/supabase-js";

const raw = createClient(
  "https://bbnmxwpacdfqvicybhau.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJibm14d3BhY2RmcXZpY3liaGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA3NDYsImV4cCI6MjA5MTAxNjc0Nn0.cGqnmu5BeaXosxoE-IEmjX-dF4zDYipzpYb5hhc8S6I"
);

// ── supabase.ts 와 동일한 래퍼 ──
const warned = new Set();
const isMissingTable = (e) => !!e && (e.code === "PGRST205" || /Could not find the table/i.test(e.message ?? ""));
function degradeResult(res, table) {
  if (res && isMissingTable(res.error)) {
    if (!warned.has(table)) { warned.add(table); console.warn(`  [warn] '${table}' 없음 → 빈 결과`); }
    return { ...res, data: [], error: null, status: 200, statusText: "OK" };
  }
  return res;
}
function wrapThenable(b, table) {
  if (!b || typeof b.then !== "function") return b;
  return new Proxy(b, { get(target, prop, receiver) {
    if (prop === "then") return (onF, onR) => target.then((res) => { const f = degradeResult(res, table); return onF ? onF(f) : f; }, onR);
    const v = target[prop];
    if (typeof v === "function") return (...a) => { const r = v.apply(target, a); return r === target ? receiver : wrapThenable(r, table); };
    return v;
  }});
}
function wrapQueryBuilder(qb, table) {
  return new Proxy(qb, { get(target, prop) {
    const v = target[prop];
    if (typeof v === "function") return (...a) => wrapThenable(v.apply(target, a), table);
    return v;
  }});
}
const supabase = new Proxy(raw, { get(target, prop) {
  if (prop === "from") return (t) => wrapQueryBuilder(target.from(t), t);
  const v = target[prop];
  return typeof v === "function" ? v.bind(target) : v;
}});

function show(label, { data, error }) {
  const d = Array.isArray(data) ? `array(${data.length})` : data === null ? "null" : typeof data;
  console.log(`  ${label.padEnd(46)} data=${d.padEnd(10)} error=${error ? `[${error.code}]` : "null"}`);
}

console.log("1) 없는 테이블 단순 select");
show("notifications.select()", await supabase.from("notifications").select("*"));

console.log("2) 없는 테이블 + 체이닝(eq/order/limit)");
show("notifications.select().eq().order().limit()",
  await supabase.from("notifications").select("*").eq("user_id", 1).order("created_at", { ascending: false }).limit(30));

console.log("3) 없는 테이블 + maybeSingle / single");
show("users.select().eq().maybeSingle()", await supabase.from("users").select("*").eq("id", 1).maybeSingle());
show("users.select().eq().single()", await supabase.from("users").select("*").eq("id", 1).single());

console.log("4) 있는 테이블 — 정상 통과 확인");
show("materials.select().limit(2)", await supabase.from("materials").select("*").limit(2));
show("accounts.select().eq().maybeSingle()", await supabase.from("accounts").select("*").eq("username", "황진한").maybeSingle());

console.log("5) 있는 테이블에서 실제 에러(잘못된 컬럼) — degrade 안 되고 그대로 통과해야 함");
show("materials.select(없는컬럼)", await supabase.from("materials").select("__no_such_col__"));
