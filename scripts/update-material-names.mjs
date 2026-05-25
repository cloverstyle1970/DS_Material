// DS 자재 품명·규격 업데이트 (ds자재 업데이트 자료_260525.xlsx 기준)
// 자재코드(id)로 매칭하여 materials.name / model_no 만 갱신 (단가·재고 등은 보존).
//   미리보기:  node scripts/update-material-names.mjs
//   실제 적용: node scripts/update-material-names.mjs --apply
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const SUPABASE_URL      = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FILE  = "C:/Users/J.H.Hwang/Downloads/ds자재 업데이트 자료_260525.xlsx";
const APPLY = process.argv.includes("--apply");

const wb   = XLSX.readFile(FILE);
const ws   = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

// 헤더: 구분(0) 자재코드(1) 부품명(2) 규격(3) ...
const data = rows.slice(1)
  .map(r => ({ id: String(r[1]).trim(), name: String(r[2]).trim(), modelNo: String(r[3]).trim() }))
  .filter(d => d.id && d.name);

console.log(`엑셀 유효 행: ${data.length}건`);

// DB 현재값 조회
const dbMap = new Map();
const ids = data.map(d => d.id);
for (let i = 0; i < ids.length; i += 300) {
  const { data: mats, error } = await supabase.from("materials").select("id, name, model_no").in("id", ids.slice(i, i + 300));
  if (error) { console.error("조회 오류:", error.message); process.exit(1); }
  (mats ?? []).forEach(m => dbMap.set(m.id, m));
}

// 비교
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

console.log(`\n— 분석 —`);
console.log(`  변경 대상   : ${targets.length}건`);
console.log(`  동일(변경X) : ${same}건`);
console.log(`  DB에 없음   : ${notInDb}건`);
console.log(`\n— 변경 샘플(최대 15) —`);
samples.forEach(s => console.log(`  [${s.id}]\n    전: ${s.before}\n    후: ${s.after}`));

if (!APPLY) {
  console.log(`\n※ 미리보기 모드입니다. 실제 적용하려면 --apply 옵션을 붙여 실행하세요.`);
  process.exit(0);
}

console.log(`\n=== 적용 시작 (${targets.length}건) ===`);
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
  results.forEach(r => { if (r.ok) ok++; else { fail++; if (fail <= 10) console.error(`  실패 ${r.id}: ${r.msg}`); } });
  console.log(`  ${Math.min(i + CHUNK, targets.length)}/${targets.length} (성공 ${ok}, 실패 ${fail})`);
}
console.log(`\n✓ 완료: 성공 ${ok}, 실패 ${fail}`);
