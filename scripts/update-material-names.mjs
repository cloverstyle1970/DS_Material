// DS ?ì¬ ?ˆëª…Â·ê·œê²© ?…ë°?´íŠ¸ (ds?ì¬ ?…ë°?´íŠ¸ ?ë£Œ_260525.xlsx ê¸°ì?)
// ?ì¬ì½”ë“œ(id)ë¡?ë§¤ì¹­?˜ì—¬ materials.name / model_no ë§?ê°±ì‹  (?¨ê?Â·?¬ê³  ?±ì? ë³´ì¡´).
//   ë¯¸ë¦¬ë³´ê¸°:  node scripts/update-material-names.mjs
//   ?¤ì œ ?ìš©: node scripts/update-material-names.mjs --apply
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const SUPABASE_URL      = "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FILE  = "C:/Users/J.H.Hwang/Downloads/ds?ì¬ ?…ë°?´íŠ¸ ?ë£Œ_260525.xlsx";
const APPLY = process.argv.includes("--apply");

const wb   = XLSX.readFile(FILE);
const ws   = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

// ?¤ë”: êµ¬ë¶„(0) ?ì¬ì½”ë“œ(1) ë¶€?ˆëª…(2) ê·œê²©(3) ...
const data = rows.slice(1)
  .map(r => ({ id: String(r[1]).trim(), name: String(r[2]).trim(), modelNo: String(r[3]).trim() }))
  .filter(d => d.id && d.name);

console.log(`?‘ì? ? íš¨ ?? ${data.length}ê±?);

// DB ?„ì¬ê°?ì¡°íšŒ
const dbMap = new Map();
const ids = data.map(d => d.id);
for (let i = 0; i < ids.length; i += 300) {
  const { data: mats, error } = await supabase.from("materials").select("id, name, model_no").in("id", ids.slice(i, i + 300));
  if (error) { console.error("ì¡°íšŒ ?¤ë¥˜:", error.message); process.exit(1); }
  (mats ?? []).forEach(m => dbMap.set(m.id, m));
}

// ë¹„êµ
const targets = [];
let same = 0, notInDb = 0;
const samples = [];
for (const d of data) {
  const cur = dbMap.get(d.id);
  if (!cur) { notInDb++; continue; }
  const nameCh = (cur.name || "") !== d.name;
  const specCh = (cur.model_no || "") !== (d.modelNo || "");
  if (nameCh || specCh) {
    targets.push(d);
    if (samples.length < 15) samples.push({ id: d.id, before: `${cur.name} | ${cur.model_no ?? ""}`, after: `${d.name} | ${d.modelNo}` });
  } else same++;
}

console.log(`\n??ë¶„ì„ ??);
console.log(`  ë³€ê²??€??  : ${targets.length}ê±?);
console.log(`  ?™ì¼(ë³€ê²½X) : ${same}ê±?);
console.log(`  DB???†ìŒ   : ${notInDb}ê±?);
console.log(`\n??ë³€ê²??˜í”Œ(ìµœë? 15) ??);
samples.forEach(s => console.log(`  [${s.id}]\n    ?? ${s.before}\n    ?? ${s.after}`));

if (!APPLY) {
  console.log(`\n??ë¯¸ë¦¬ë³´ê¸° ëª¨ë“œ?…ë‹ˆ?? ?¤ì œ ?ìš©?˜ë ¤ë©?--apply ?µì…˜??ë¶™ì—¬ ?¤í–‰?˜ì„¸??`);
  process.exit(0);
}

console.log(`\n=== ?ìš© ?œì‘ (${targets.length}ê±? ===`);
let ok = 0, fail = 0;
const CHUNK = 40;
for (let i = 0; i < targets.length; i += CHUNK) {
  const chunk = targets.slice(i, i + CHUNK);
  const results = await Promise.all(chunk.map(async d => {
    const { error } = await supabase.from("materials")
      .update({ name: d.name, model_no: d.modelNo || null })
      .eq("id", d.id);
    return error ? { ok: false, id: d.id, msg: error.message } : { ok: true };
  }));
  results.forEach(r => { if (r.ok) ok++; else { fail++; if (fail <= 10) console.error(`  ?¤íŒ¨ ${r.id}: ${r.msg}`); } });
  console.log(`  ${Math.min(i + CHUNK, targets.length)}/${targets.length} (?±ê³µ ${ok}, ?¤íŒ¨ ${fail})`);
}
console.log(`\n???„ë£Œ: ?±ê³µ ${ok}, ?¤íŒ¨ ${fail}`);
