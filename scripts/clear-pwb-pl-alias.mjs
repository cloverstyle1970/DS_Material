/**
 * ì¹˜í™˜ ?„ë£Œ??PWB-PL ?‰ë“¤??alias ë°±ì—… ë¹„ìš°ê¸? *   WHERE alias='PWB-PL' ??alias=NULL
 * ?¤í–‰: node scripts/clear-pwb-pl-alias.mjs
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://bbnmxwpacdfqvicybhau.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { data: before } = await sb
  .from("materials")
  .select("id")
  .eq("alias", "PWB-PL");

const targetCount = before?.length ?? 0;
console.log(`[Pre] alias='PWB-PL' ?? ${targetCount}ê±?);

if (targetCount === 0) {
  console.log("?€???†ìŒ ??ì¢…ë£Œ");
  process.exit(0);
}

// ?¼ê´„ UPDATE ??Supabase ??PATCH /materials?alias=eq.PWB-PL ?¼ë¡œ ??ë²ˆì— ì²˜ë¦¬
const { error, count } = await sb
  .from("materials")
  .update({ alias: null }, { count: "exact" })
  .eq("alias", "PWB-PL");

if (error) { console.error("ERR:", error); process.exit(1); }

// ?¬í›„ ?•ì¸
const { data: after } = await sb
  .from("materials")
  .select("id")
  .eq("alias", "PWB-PL");

console.log(`[Apply] update ë°˜í™˜ count=${count ?? "n/a"}`);
console.log(`[Post] alias='PWB-PL' ?”ì—¬: ${after?.length ?? 0}ê±? ${(after?.length ?? 0) === 0 ? "?? : "!"}`);
