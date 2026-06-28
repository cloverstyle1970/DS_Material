"use client";

import { Fragment, useEffect, useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import { nextDocNo, type RiskCategory, type RiskHazardItem } from "@/lib/risk";

const inputCls =
  "px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-rose-400";

// 유해·위험요인 본문에서 재해형태 추출(유해요인조사표 엑셀에 별도 컬럼이 없을 때)
const ACCIDENT_KW = ["협착", "끼임", "압착", "추락", "전도", "충돌", "감전", "낙하", "자상", "베임", "좌상", "요통", "갇힘"];
function extractAccidentType(text: string): string {
  const found: string[] = [];
  for (const k of ACCIDENT_KW) {
    if (text.includes(k)) {
      const n = k === "베임" ? "자상" : k;
      if (!found.includes(n)) found.push(n);
    }
  }
  if (text.includes("찢어짐") && !found.includes("자상")) found.push("자상");
  if (text.includes("허리통증") && !found.includes("요통")) found.push("요통");
  if (text.includes("어지러움")) found.push("건강장해");
  if (text.includes("교통사고")) found.push("교통");
  return found.join("/");
}

// 대분류·항목 마스터 — 유해요인조사표의 전체 항목 + 기본 유/무를 관리.
// (위험성평가 항목의 원본이기도 함)
export default function HazardMasterPanel({ canWrite }: { canWrite: boolean }) {
  const [cats, setCats] = useState<RiskCategory[]>([]);
  const [selCat, setSelCat] = useState<number | null>(null);
  const [items, setItems] = useState<RiskHazardItem[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadCats = useCallback(async () => {
    const { data } = await supabase.from("risk_categories").select("*").order("sort_order");
    const list = (data ?? []) as RiskCategory[];
    setCats(list);
    setSelCat((prev) => prev ?? (list[0]?.id ?? null));
  }, []);

  const loadItems = useCallback(async (cid: number) => {
    const { data } = await supabase.from("risk_hazard_items").select("*").eq("category_id", cid).order("sort_order");
    setItems((data ?? []) as RiskHazardItem[]);
  }, []);

  useEffect(() => {
    void loadCats();
  }, [loadCats]);
  useEffect(() => {
    if (selCat != null) void loadItems(selCat);
  }, [selCat, loadItems]);
  useReloadOnActivate(() => {
    void loadCats();
  });

  async function addCat() {
    const name = prompt("대분류 이름 (예: 수리공사(쉬브))");
    if (!name) return;
    const sub = prompt("중분류 공정 (선택)") ?? "";
    const doc = nextDocNo(cats.map((c) => c.doc_no));
    const maxSort = cats.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
    const { error } = await supabase
      .from("risk_categories")
      .insert({ name, doc_no: doc, sub_process: sub || null, sort_order: maxSort + 1 });
    if (error) return alert("추가 실패: " + error.message);
    void loadCats();
  }

  // 엑셀(유해요인조사표 양식) 업로드 → 대분류 + 항목 일괄 등록
  // 양식: NO(A) | 대분류(B) | 중분류(C) | 유해·위험요인(D) | 유(F) | 무(G)
  async function importExcel(file: File) {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });

      let catName = "";
      let gubun = "";
      const parsed: { gubun: string; hazard: string; at: string; present: boolean }[] = [];
      for (const row of aoa) {
        const no = String((row as unknown[])[0] ?? "").trim();
        const b = String((row as unknown[])[1] ?? "").trim();
        const c = String((row as unknown[])[2] ?? "").trim();
        const hazard = String((row as unknown[])[3] ?? "").trim();
        const f = String((row as unknown[])[5] ?? "").trim();
        if (!/^\d+$/.test(no)) continue; // 데이터 행(NO 숫자)만
        if (b) catName = catName || b;
        if (c) gubun = c;
        if (!hazard) continue;
        parsed.push({ gubun, hazard, at: extractAccidentType(hazard), present: f !== "" });
      }

      if (!catName) {
        alert("엑셀에서 대분류명을 찾지 못했습니다. (B열 대분류 / D열 유해·위험요인 형식 확인)");
        return;
      }
      if (parsed.length === 0) {
        alert("등록할 유해요인 항목이 없습니다.");
        return;
      }

      const subProcess = [...new Set(parsed.map((p) => p.gubun).filter(Boolean))].join("/");
      const yes = parsed.filter((p) => p.present).length;

      const existing = cats.find((c) => c.name === catName);
      let catId: number;
      if (existing) {
        if (!confirm(`'${catName}' 대분류가 이미 있습니다.\n이 파일의 ${parsed.length}개 항목(유 ${yes})으로 교체할까요?`)) return;
        await supabase.from("risk_categories").update({ sub_process: subProcess || null }).eq("id", existing.id);
        await supabase.from("risk_hazard_items").delete().eq("category_id", existing.id);
        catId = existing.id;
      } else {
        if (!confirm(`새 대분류 '${catName}'를 추가합니다.\n항목 ${parsed.length}개(유 ${yes}) 등록할까요?`)) return;
        const doc = nextDocNo(cats.map((c) => c.doc_no));
        const maxSort = cats.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
        const { data, error } = await supabase
          .from("risk_categories")
          .insert({ name: catName, doc_no: doc, sub_process: subProcess || null, sort_order: maxSort + 1 })
          .select("id")
          .single();
        if (error || !data) return alert("대분류 추가 실패: " + (error?.message ?? ""));
        catId = data.id;
      }

      const rows = parsed.map((p, i) => ({
        category_id: catId,
        gubun: p.gubun || null,
        hazard: p.hazard,
        accident_type: p.at || null,
        default_present: p.present,
        sort_order: i + 1,
      }));
      const { error: e2 } = await supabase.from("risk_hazard_items").insert(rows);
      if (e2) return alert("항목 등록 실패: " + e2.message);

      alert(`'${catName}' 등록 완료: 항목 ${rows.length}개(유 ${yes})`);
      await loadCats();
      setSelCat(catId);
    } catch (e) {
      alert("엑셀 처리 실패: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImporting(false);
    }
  }

  async function editCat(c: RiskCategory) {
    const name = prompt("대분류 이름", c.name);
    if (name == null) return;
    const sub = prompt("중분류 공정", c.sub_process ?? "") ?? "";
    const doc = prompt("문서번호", c.doc_no) ?? c.doc_no;
    const { error } = await supabase
      .from("risk_categories")
      .update({ name, sub_process: sub || null, doc_no: doc })
      .eq("id", c.id);
    if (error) return alert("수정 실패: " + error.message);
    void loadCats();
  }

  async function delCat(c: RiskCategory) {
    if (!confirm(`'${c.name}' 대분류와 그 유해요인 항목을 모두 삭제할까요?\n(연결된 조사 내역도 함께 삭제됩니다)`)) return;
    const { error } = await supabase.from("risk_categories").delete().eq("id", c.id);
    if (error) return alert("삭제 실패: " + error.message);
    setSelCat(null);
    void loadCats();
  }

  const cat = cats.find((c) => c.id === selCat) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* 대분류 선택 (조사표 등록과 동일한 드롭다운 형태) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">대분류 공정</span>
            <select
              className={inputCls}
              value={selCat ?? ""}
              onChange={(e) => setSelCat(e.target.value === "" ? null : Number(e.target.value))}
            >
              {cats.length === 0 && <option value="">(등록된 대분류 없음)</option>}
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.doc_no}] {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">중분류 공정</span>
            <input className={`${inputCls} bg-gray-50 dark:bg-gray-900/40`} value={cat?.sub_process ?? ""} readOnly />
          </label>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={addCat}
              className="px-2.5 py-1 text-xs rounded bg-rose-600 text-white font-semibold hover:bg-rose-700"
            >
              + 대분류 추가
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importExcel(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              className="px-2.5 py-1 text-xs rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {importing ? "등록 중…" : "📤 엑셀로 추가"}
            </button>
            <span className="text-[11px] text-gray-400">유해요인조사표 양식(.xlsx)</span>
            <button
              type="button"
              disabled={!cat}
              onClick={() => cat && editCat(cat)}
              className="px-2.5 py-1 text-xs rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 disabled:opacity-50"
            >
              대분류 수정
            </button>
            <button
              type="button"
              disabled={!cat}
              onClick={() => cat && delCat(cat)}
              className="px-2.5 py-1 text-xs rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 disabled:opacity-50"
            >
              대분류 삭제
            </button>
          </div>
        )}
      </div>

      {/* 항목 마스터 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {!cat ? (
          <div className="p-12 text-center text-sm text-gray-400">대분류 공정을 선택하세요.</div>
        ) : (
          <ItemEditor cat={cat} items={items} canWrite={canWrite} reload={() => loadItems(cat.id)} />
        )}
      </div>
    </div>
  );
}

function ItemEditor({
  cat,
  items,
  canWrite,
  reload,
}: {
  cat: RiskCategory;
  items: RiskHazardItem[];
  canWrite: boolean;
  reload: () => void;
}) {
  const [editing, setEditing] = useState<Partial<RiskHazardItem> | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // 대분류 변경 시 기본 접힘으로 초기화
  useEffect(() => {
    setExpandedGroups(new Set());
  }, [cat.id]);

  function toggleGroup(g: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  // 구분(중분류)별 그룹
  const itemGroups: { gubun: string; items: RiskHazardItem[] }[] = [];
  for (const it of items) {
    const g = it.gubun ?? "";
    const last = itemGroups[itemGroups.length - 1];
    if (last && last.gubun === g) last.items.push(it);
    else itemGroups.push({ gubun: g, items: [it] });
  }

  async function saveItem() {
    if (!editing || !editing.hazard) {
      alert("유해·위험요인을 입력하세요.");
      return;
    }
    const payload = {
      category_id: cat.id,
      gubun: editing.gubun ?? null,
      hazard: editing.hazard,
      accident_type: editing.accident_type ?? null,
      current_measure: editing.current_measure ?? null,
      default_improvement: editing.current_measure ?? null,
      default_present: editing.default_present ?? false,
      sort_order: editing.sort_order ?? items.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0) + 1,
    };
    const { error } = editing.id
      ? await supabase.from("risk_hazard_items").update(payload).eq("id", editing.id)
      : await supabase.from("risk_hazard_items").insert(payload);
    if (error) return alert("저장 실패: " + error.message);
    setEditing(null);
    reload();
  }

  async function delItem(it: RiskHazardItem) {
    if (!confirm("이 항목을 삭제할까요?")) return;
    const { error } = await supabase.from("risk_hazard_items").delete().eq("id", it.id);
    if (error) return alert("삭제 실패: " + error.message);
    reload();
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          [{cat.doc_no}] {cat.name} · 유해요인 {items.length}건
        </span>
        <div className="ml-auto flex items-center gap-2">
          {itemGroups.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setExpandedGroups((prev) =>
                  prev.size === itemGroups.length ? new Set() : new Set(itemGroups.map((g) => g.gubun))
                )
              }
              className="px-2.5 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold hover:bg-gray-200"
            >
              {expandedGroups.size === itemGroups.length ? "전체 접기" : "전체 펼치기"}
            </button>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={() => setEditing({ gubun: items[items.length - 1]?.gubun ?? "" })}
              className="px-2.5 py-1 text-xs rounded bg-rose-600 text-white font-semibold hover:bg-rose-700"
            >
              + 항목 추가
            </button>
          )}
        </div>
      </div>

      <div className="overflow-auto max-h-[60vh]">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300">
              <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left">유해·위험요인</th>
              <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-16">재해형태</th>
              <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-14">기본 유/무</th>
              <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left w-56">현 안전조치</th>
              {canWrite && <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">관리</th>}
            </tr>
          </thead>
          <tbody>
            {itemGroups.map((g, gi) => {
              const open = expandedGroups.has(g.gubun);
              const cols = canWrite ? 5 : 4;
              return (
              <Fragment key={gi}>
                <tr
                  className="cursor-pointer bg-blue-50/60 dark:bg-blue-900/20 hover:bg-blue-100/60 dark:hover:bg-blue-900/30"
                  onClick={() => toggleGroup(g.gubun)}
                >
                  <td colSpan={cols} className="border border-gray-200 dark:border-gray-700 px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-blue-400 text-xs transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`}>▾</span>
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{g.gubun || "(구분 미지정)"}</span>
                      <span className="text-[11px] text-gray-400">({g.items.length})</span>
                    </div>
                  </td>
                </tr>
                {open && g.items.map((it) => (
                  <tr key={it.id} className="align-top text-gray-800 dark:text-gray-100">
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 pl-6">{it.hazard}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">{it.accident_type}</td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          it.default_present
                            ? "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-400"
                        }`}
                      >
                        {it.default_present ? "유" : "무"}
                      </span>
                    </td>
                    <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 whitespace-pre-wrap">{it.current_measure}</td>
                    {canWrite && (
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2">
                        <div className="flex gap-1 justify-center">
                          <button
                            type="button"
                            onClick={() => setEditing(it)}
                            className="px-1.5 py-0.5 text-[11px] rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => delItem(it)}
                            className="px-1.5 py-0.5 text-[11px] rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </Fragment>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={canWrite ? 5 : 4} className="border border-gray-200 dark:border-gray-700 px-2 py-8 text-center text-gray-400">
                  등록된 항목이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-lg p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">{editing.id ? "항목 수정" : "항목 추가"}</h3>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">구분</span>
              <input
                className={inputCls}
                value={editing.gubun ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p!, gubun: e.target.value }))}
                placeholder="예) 기계실 / 카상부점검 / 승강장 / PIT"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">안전보건 유해·위험요인</span>
              <textarea
                className={`${inputCls} min-h-[60px]`}
                value={editing.hazard ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p!, hazard: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">재해 형태</span>
              <input
                className={inputCls}
                value={editing.accident_type ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p!, accident_type: e.target.value }))}
                placeholder="예) 협착 / 감전 / 추락"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">현 안전조치</span>
              <textarea
                className={`${inputCls} min-h-[70px]`}
                value={editing.current_measure ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p!, current_measure: e.target.value }))}
              />
            </label>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                기본 유/무 <span className="text-gray-400 font-normal">(조사표 초기값)</span>
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setEditing((p) => ({ ...p!, default_present: true }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    editing.default_present
                      ? "bg-rose-600 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300"
                  }`}
                >
                  유
                </button>
                <button
                  type="button"
                  onClick={() => setEditing((p) => ({ ...p!, default_present: false }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                    !editing.default_present
                      ? "bg-gray-700 text-white dark:bg-gray-600"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300"
                  }`}
                >
                  무
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold"
              >
                취소
              </button>
              <button
                type="button"
                onClick={saveItem}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
