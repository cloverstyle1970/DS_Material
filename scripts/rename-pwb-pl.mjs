/**
 * PWB-PL ?êÏû¨ ?ºÍ¥Ñ ÏπòÌôò:
 *   name='PWB-PL' ?âÏóê ?Ä????alias=name Î∞±ÏóÖ ??name=model_no(Í∑úÍ≤©) ??model_no=NULL
 * ?§Ìñâ: node scripts/rename-pwb-pl.mjs
 *
 * Î°§Î∞±:
 *   UPDATE materials SET name='PWB-PL', model_no=alias, alias=NULL WHERE alias='PWB-PL';
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const C = s => `\x1b[36m${s}\x1b[0m`;

// ?Ä?Ä?Ä 1. Pre-check ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
const { data: before, error: e0 } = await sb
  .from("materials")
  .select("id, name, model_no, alias")
  .eq("name", "PWB-PL");
if (e0) { console.error(R("PRE-FETCH ERROR:"), e0); process.exit(1); }

const total = before.length;
const noModel = before.filter(r => !r.model_no || !String(r.model_no).trim());
const hasAlias = before.filter(r => r.alias && String(r.alias).trim());
console.log(C(`[Pre-check] name='PWB-PL' ?? ${total}Í±?));
console.log(`  - Í∑úÍ≤©(model_no) ÎπÑÏñ¥?àÏùå (ÏπòÌôò ?úÏô∏): ${noModel.length}Í±?);
console.log(`  - alias ÎπÑÏñ¥?àÏ? ?äÏùå (Î∞±ÏóÖ ?ÑÌóò): ${hasAlias.length}Í±?);

if (hasAlias.length > 0) {
  console.error(R(`[Ï§ëÎã®] aliasÍ∞Ä ?¥Î? ?¨Ïö© Ï§ëÏù∏ ?âÏù¥ ${hasAlias.length}Í±??àÏñ¥ Î∞±ÏóÖ Ï∂©Îèå ?ÑÌóò.`));
  for (const r of hasAlias.slice(0, 10)) console.error(`  ! ${r.id} alias="${r.alias}"`);
  process.exit(1);
}

const targets = before.filter(r => r.model_no && String(r.model_no).trim());
console.log(`  ??ÏπòÌôò ?Ä?? ${G(targets.length + "Í±?)}`);

// ?Ä?Ä?Ä 2. Apply per-row ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
console.log("");
console.log(C("[Apply] alias=PWB-PL Î∞±ÏóÖ + name=model_no + model_no=NULL Í∞±Ïã†..."));
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
    process.stdout.write(`\r  ÏßÑÌñâ: ${i + 1}/${targets.length}  (?±Í≥µ ${ok} / ?§Ìå® ${fail})`);
  }
}
console.log("");

if (fail > 0) {
  console.error(R(`\n[?§Ìå® ${fail}Í±?`));
  for (const f of failures.slice(0, 20)) console.error(`  ! ${f.id}: ${f.err}`);
}

// ?Ä?Ä?Ä 3. Post-check ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
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
console.log(`  ?îÏó¨ name='PWB-PL' ?? ${stillPwb.length}Í±? ${stillPwb.length === noModel.length ? G("(?àÏÉÅÏπ??ºÏπò ??Í∑úÍ≤© ÎπÑÏóà???âÎßå ?®Ïùå)") : R("(Î∂àÏùºÏπ?)")}`);
console.log(`  alias='PWB-PL' Î∞±ÏóÖ ?? ${renamed.length}Í±? ${renamed.length === ok ? G("(?±Í≥µ ?òÏ? ?ºÏπò)") : R("(Î∂àÏùºÏπ?)")}`);

console.log("");
console.log(C("[?òÌîå 5Í±?"));
for (const r of renamed.slice(0, 5)) {
  console.log(`  ${r.id}  name="${r.name}"  model_no=${JSON.stringify(r.model_no)}  alias="${r.alias}"`);
}

console.log("");
console.log(G(`?ÑÎ£å. ?±Í≥µ ${ok}Í±?/ ?§Ìå® ${fail}Í±?));
