// 교체공사 공수 표준 import (labor_workload_standards 시드)
//   원본: C:/Users/J.H.Hwang/Downloads/교체공사 공수자료_211126(대솔).xlsx
//   실행: node scripts/import-workload-standards.mjs
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const XLSX_PATH = "C:/Users/J.H.Hwang/Downloads/교체공사 공수자료_211126(대솔).xlsx";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 셀 정제: 줄바꿈/중복 토큰 제거 (예: "MR\r\n\r\nMR" → "MR", 더블스페이스 → 싱글)
function clean(v) {
  let s = String(v ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  // 동일 토큰 반복 제거 ("MR MR" → "MR")
  const parts = s.split(" ");
  if (parts.length === 2 && parts[0] === parts[1]) s = parts[0];
  return s;
}

const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets["Sheet1"];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
const data = raw.slice(3, 52); // 행3~51 = 49건

let cat = "", type = "";
const rows = data.map((r, i) => {
  const c0 = clean(r[0]); // 품명(대분류)
  const c1 = clean(r[1]); // TYPE
  const c2 = clean(r[2]); // 보조구분(MR/MRL)
  const c3 = clean(r[3]); // 세부/층수
  const c4 = r[4];        // 공수
  if (c0) cat = c0;       // forward-fill (병합 셀)
  if (c1) type = c1;
  const man = (c4 === "" || c4 == null) ? null : Number(c4);
  return {
    code:        "WL" + String(i + 1).padStart(3, "0"),
    category:    cat,
    type_name:   type || null,
    subtype:     (c2 && c2 !== "-") ? c2 : null,
    floor_range: (c3 && c3 !== "-") ? c3 : null,
    man_days:    man,
    is_active:   true,
    sort_order:  (i + 1) * 10,
    note:        man == null ? "별도 견적" : null,
  };
});

console.log(`총 ${rows.length}건 (미기재 ${rows.filter(r => r.man_days == null).length}건) import 시작...`);

const { error } = await supabase
  .from("labor_workload_standards")
  .upsert(rows, { onConflict: "code" });

if (error) {
  console.error("import 실패:", error.message);
  process.exit(1);
}
console.log("✅ import 완료:", rows.length, "건");
