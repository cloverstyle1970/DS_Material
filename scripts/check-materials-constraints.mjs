/**
 * materials.name / materials.model_no ???¸ë±???œì•½ ?•ì¸
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 1. PWB-PL ?¸ì— ?™ì¼ model_no ê°€ì§??¤ë¥¸ ?ìž¬ê°€ ???ˆëŠ”ì§€ (?„ì—­ ì¶©ëŒ ?•ì¸)
const { data: pwbList } = await sb
  .from("materials")
  .select("id, name, model_no")
  .eq("name", "PWB-PL");

const modelSet = new Set((pwbList ?? []).map(r => String(r.model_no ?? "").trim()).filter(Boolean));
console.log(`PWB-PL ê·œê²© ì¢…ë¥˜: ${modelSet.size}ê°?);

// 2. ê·?model_no ê°’ë“¤??PWB-PL ?¸ì˜ ?‰ì—???´ë? name?¼ë¡œ ?°ì´ê³??ˆëŠ”ì§€ ?•ì¸
//    (= ì¹˜í™˜ ???¤ë¥¸ ?ìž¬?€ name ì¶©ëŒ)
const samples = [...modelSet].slice(0, 15);
const { data: existing } = await sb
  .from("materials")
  .select("id, name, model_no")
  .in("name", samples)
  .neq("name", "PWB-PL");

console.log("");
console.log(`?˜í”Œ 15ì¢?ê·œê²©???´ë? ?¤ë¥¸ ?ìž¬??[?ˆëª…]?¼ë¡œ ?°ì´??ê²½ìš°: ${(existing ?? []).length}ê±?);
for (const r of (existing ?? [])) {
  console.log(`  - ${r.id} | name="${r.name}" | model_no="${r.model_no ?? ""}"`);
}

// 3. ?„ì²´ PWB-PL ê·œê²©???¤ë¥¸ ?ìž¬??name?¼ë¡œ ì¶©ëŒ?˜ëŠ”ì§€ ?¼ê´„ ì²´í¬
const { data: allConflict } = await sb
  .from("materials")
  .select("id, name")
  .in("name", [...modelSet])
  .neq("name", "PWB-PL");

console.log("");
console.log(`[?„ì²´ ì¶©ëŒ] 80ì¢?ê·œê²© ì¤??¤ë¥¸ ?ìž¬??nameê³?ì¶©ëŒ: ${(allConflict ?? []).length}ê±?);
if ((allConflict ?? []).length > 0) {
  for (const r of allConflict.slice(0, 20)) {
    console.log(`  ! ${r.id} | name="${r.name}"`);
  }
}
