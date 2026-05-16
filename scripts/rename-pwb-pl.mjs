/**
 * PWB-PL 자재 일괄 치환:
 *   name='PWB-PL' 행에 대해 → alias=name 백업 → name=model_no(규격) → model_no=NULL
 * 실행: node scripts/rename-pwb-pl.mjs
 *
 * 롤백:
 *   UPDATE materials SET name='PWB-PL', model_no=alias, alias=NULL WHERE alias='PWB-PL';
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const C = s => `\x1b[36m${s}\x1b[0m`;

// ─── 1. Pre-check ────────────────────────────────────────────────
const { data: before, error: e0 } = await sb
  .from("materials")
  .select("id, name, model_no, alias")
  .eq("name", "PWB-PL");
if (e0) { console.error(R("PRE-FETCH ERROR:"), e0); process.exit(1); }

const total = before.length;
const noModel = before.filter(r => !r.model_no || !String(r.model_no).trim());
const hasAlias = before.filter(r => r.alias && String(r.alias).trim());
console.log(C(`[Pre-check] name='PWB-PL' 행: ${total}건`));
console.log(`  - 규격(model_no) 비어있음 (치환 제외): ${noModel.length}건`);
console.log(`  - alias 비어있지 않음 (백업 위험): ${hasAlias.length}건`);

if (hasAlias.length > 0) {
  console.error(R(`[중단] alias가 이미 사용 중인 행이 ${hasAlias.length}건 있어 백업 충돌 위험.`));
  for (const r of hasAlias.slice(0, 10)) console.error(`  ! ${r.id} alias="${r.alias}"`);
  process.exit(1);
}

const targets = before.filter(r => r.model_no && String(r.model_no).trim());
console.log(`  → 치환 대상: ${G(targets.length + "건")}`);

// ─── 2. Apply per-row ────────────────────────────────────────────
console.log("");
console.log(C("[Apply] alias=PWB-PL 백업 + name=model_no + model_no=NULL 갱신..."));
let ok = 0, fail = 0;
const failures = [];
for (let i = 0; i < targets.length; i++) {
  const r = targets[i];
  const newName = String(r.model_no).trim();
  const { error } = await sb
    .from("materials")
    .update({ alias: "PWB-PL", name: newName, model_no: null })
    .eq("id", r.id);
  if (error) {
    fail++;
    failures.push({ id: r.id, err: error.message });
  } else {
    ok++;
  }
  if ((i + 1) % 25 === 0 || i === targets.length - 1) {
    process.stdout.write(`\r  진행: ${i + 1}/${targets.length}  (성공 ${ok} / 실패 ${fail})`);
  }
}
console.log("");

if (fail > 0) {
  console.error(R(`\n[실패 ${fail}건]`));
  for (const f of failures.slice(0, 20)) console.error(`  ! ${f.id}: ${f.err}`);
}

// ─── 3. Post-check ───────────────────────────────────────────────
const { data: stillPwb } = await sb
  .from("materials")
  .select("id, name, model_no")
  .eq("name", "PWB-PL");
const { data: renamed } = await sb
  .from("materials")
  .select("id, name, model_no, alias")
  .eq("alias", "PWB-PL");

console.log("");
console.log(C("[Post-check]"));
console.log(`  잔여 name='PWB-PL' 행: ${stillPwb.length}건  ${stillPwb.length === noModel.length ? G("(예상치 일치 — 규격 비었던 행만 남음)") : R("(불일치!)")}`);
console.log(`  alias='PWB-PL' 백업 행: ${renamed.length}건  ${renamed.length === ok ? G("(성공 수와 일치)") : R("(불일치!)")}`);

console.log("");
console.log(C("[샘플 5건]"));
for (const r of renamed.slice(0, 5)) {
  console.log(`  ${r.id}  name="${r.name}"  model_no=${JSON.stringify(r.model_no)}  alias="${r.alias}"`);
}

console.log("");
console.log(G(`완료. 성공 ${ok}건 / 실패 ${fail}건`));
