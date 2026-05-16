/**
 * 치환 완료한 PWB-PL 행들의 alias 백업 비우기
 *   WHERE alias='PWB-PL' → alias=NULL
 * 실행: node scripts/clear-pwb-pl-alias.mjs
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = "https://gwgzzsoknjulwwsmubju.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ONRnSvrXjF9V7HKbFhkpqg_8sOqdvLJ";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { data: before } = await sb
  .from("materials")
  .select("id")
  .eq("alias", "PWB-PL");

const targetCount = before?.length ?? 0;
console.log(`[Pre] alias='PWB-PL' 행: ${targetCount}건`);

if (targetCount === 0) {
  console.log("대상 없음 — 종료");
  process.exit(0);
}

// 일괄 UPDATE — Supabase 는 PATCH /materials?alias=eq.PWB-PL 으로 한 번에 처리
const { error, count } = await sb
  .from("materials")
  .update({ alias: null }, { count: "exact" })
  .eq("alias", "PWB-PL");

if (error) { console.error("ERR:", error); process.exit(1); }

// 사후 확인
const { data: after } = await sb
  .from("materials")
  .select("id")
  .eq("alias", "PWB-PL");

console.log(`[Apply] update 반환 count=${count ?? "n/a"}`);
console.log(`[Post] alias='PWB-PL' 잔여: ${after?.length ?? 0}건  ${(after?.length ?? 0) === 0 ? "✓" : "!"}`);
