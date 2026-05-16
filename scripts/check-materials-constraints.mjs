/**
 * materials.name / materials.model_no 의 인덱스/제약 확인
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 1. PWB-PL 외에 동일 model_no 가진 다른 자재가 더 있는지 (전역 충돌 확인)
const { data: pwbList } = await sb
  .from("materials")
  .select("id, name, model_no")
  .eq("name", "PWB-PL");

const modelSet = new Set((pwbList ?? []).map(r => String(r.model_no ?? "").trim()).filter(Boolean));
console.log(`PWB-PL 규격 종류: ${modelSet.size}개`);

// 2. 그 model_no 값들이 PWB-PL 외의 행에서 이미 name으로 쓰이고 있는지 확인
//    (= 치환 후 다른 자재와 name 충돌)
const samples = [...modelSet].slice(0, 15);
const { data: existing } = await sb
  .from("materials")
  .select("id, name, model_no")
  .in("name", samples)
  .neq("name", "PWB-PL");

console.log("");
console.log(`샘플 15종 규격이 이미 다른 자재의 [품명]으로 쓰이는 경우: ${(existing ?? []).length}건`);
for (const r of (existing ?? [])) {
  console.log(`  - ${r.id} | name="${r.name}" | model_no="${r.model_no ?? ""}"`);
}

// 3. 전체 PWB-PL 규격이 다른 자재의 name으로 충돌하는지 일괄 체크
const { data: allConflict } = await sb
  .from("materials")
  .select("id, name")
  .in("name", [...modelSet])
  .neq("name", "PWB-PL");

console.log("");
console.log(`[전체 충돌] 80종 규격 중 다른 자재의 name과 충돌: ${(allConflict ?? []).length}건`);
if ((allConflict ?? []).length > 0) {
  for (const r of allConflict.slice(0, 20)) {
    console.log(`  ! ${r.id} | name="${r.name}"`);
  }
}
