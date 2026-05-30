"use client";

import { useEffect, useState } from "react";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";
import { fmtNum, parseNum } from "@/lib/format";
import * as XLSX from "xlsx";

const MENU_HREF = "/quotes/labor-rates";

interface LaborRate {
  id: number;
  process_code: string;
  process_name: string;
  category: string | null;
  unit: string | null;
  unit_price: number;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}


export default function LaborRatesClient() {
  const { user } = useAuth();
  const [rows, setRows] = useState<LaborRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [editing, setEditing] = useState<LaborRate | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("labor_rates").select("*").order("sort_order").order("process_code");
    setRows((data ?? []) as LaborRate[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  const admin = isAdmin(user);
  const canRead   = admin || hasMenuPermission(user, MENU_HREF, "read");
  const canCreate = admin || hasMenuPermission(user, MENU_HREF, "create");
  const canUpdate = admin || hasMenuPermission(user, MENU_HREF, "update");
  if (!canRead) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }

  const filtered = rows
    .filter(r => activeFilter === "all" ? true : activeFilter === "active" ? r.is_active : !r.is_active)
    .filter(r => {
      if (!search.trim()) return true;
      const s = search.trim().toLowerCase();
      return r.process_code.toLowerCase().includes(s)
        || r.process_name.toLowerCase().includes(s)
        || (r.category ?? "").toLowerCase().includes(s);
    });

  async function deleteRow(r: LaborRate) {
    if (!admin) return;
    if (!confirm(`${r.process_name} (${r.process_code}) 을(를) 삭제하시겠습니까?`)) return;
    const { error } = await supabase.from("labor_rates").delete().eq("id", r.id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    await load();
  }

  async function toggleActive(r: LaborRate) {
    if (!canUpdate) return;
    const { error } = await supabase.from("labor_rates").update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) { alert(`변경 실패: ${error.message}`); return; }
    await load();
  }

  function downloadXlsx() {
    // 현재 필터(active/inactive/all + 검색)가 적용된 결과를 그대로 export
    const header = ["코드", "공정명", "분류", "단위", "단가", "설명", "활성", "정렬"];
    const body = filtered.map(r => [
      r.process_code,
      r.process_name,
      r.category ?? "",
      r.unit ?? "",
      r.unit_price ?? 0,
      r.description ?? "",
      r.is_active ? "활성" : "비활성",
      r.sort_order,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 40 }, { wch: 8 }, { wch: 6 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "공임단가");
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(wb, `공임단가_${ts}.xlsx`);
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">공임 단가표</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">공정별 단가 등록 (견적서 작성 시 참조)</p>
      </div>

      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {([["active","활성"],["inactive","비활성"],["all","전체"]] as ["active"|"inactive"|"all", string][]).map(([f, l]) => (
            <button key={f} type="button" onClick={() => setActiveFilter(f)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-full border ${
                activeFilter === f
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600"
              }`}>{l}</button>
          ))}
        </div>
        <input type="text" lang="ko" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="코드·공정명·분류 검색"
          className="flex-1 max-w-md px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs" />
        <button type="button" onClick={downloadXlsx} disabled={filtered.length === 0}
          className="ml-auto px-3 py-1.5 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
          📥 엑셀 다운로드 ({filtered.length})
        </button>
        {canCreate && (
          <button type="button" onClick={() => setShowNew(true)}
            className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">+ 공정 추가</button>
        )}
      </div>

      <div className="px-6 py-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr className="text-center text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  <th className="px-3 py-2.5">코드</th>
                  <th className="px-3 py-2.5">공정명</th>
                  <th className="px-3 py-2.5">분류</th>
                  <th className="px-3 py-2.5">단위</th>
                  <th className="px-3 py-2.5">단가</th>
                  <th className="px-3 py-2.5">설명</th>
                  <th className="px-3 py-2.5">활성</th>
                  <th className="px-3 py-2.5">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && <tr><td colSpan={8} className="text-center py-8 text-xs text-gray-500">로딩 중...</td></tr>}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-xs text-gray-500">등록된 공정이 없습니다.</td></tr>
                )}
                {!loading && filtered.map(r => (
                  <tr key={r.id} className={`text-center hover:bg-gray-50 dark:hover:bg-gray-700/30 ${!r.is_active ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-200">{r.process_code}</td>
                    <td className="px-3 py-2.5 text-xs font-medium text-gray-800 dark:text-gray-100">{r.process_name}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400">{r.category ?? "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{r.unit ?? "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-800 dark:text-gray-100 font-bold tabular-nums">{fmtNum(r.unit_price)}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 max-w-xs truncate">{r.description ?? "-"}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" disabled={!canUpdate} onClick={() => toggleActive(r)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          r.is_active
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                            : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                        } ${canUpdate ? "hover:opacity-80 cursor-pointer" : ""}`}>
                        {r.is_active ? "활성" : "비활성"}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex justify-center gap-1">
                        {canUpdate && (
                          <button type="button" onClick={() => setEditing(r)}
                            className="px-2 py-0.5 text-[11px] rounded bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100">수정</button>
                        )}
                        {admin && (
                          <button type="button" onClick={() => deleteRow(r)}
                            className="px-2 py-0.5 text-[11px] rounded bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-100">삭제</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(showNew || editing) && (
        <LaborRateModal
          initial={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={() => { setShowNew(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// 공정 등록/수정 모달
// ============================================================

function LaborRateModal({
  initial, onClose, onSaved,
}: {
  initial: LaborRate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(initial?.process_code ?? "");
  const [name, setName] = useState(initial?.process_name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "인공");
  const [unitPrice, setUnitPrice] = useState<number>(initial?.unit_price ?? 0);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sortOrder, setSortOrder] = useState<number>(initial?.sort_order ?? 0);
  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    if (!code.trim() || !name.trim()) { setError("코드와 공정명은 필수입니다."); return; }
    setSaving(true);
    try {
      const payload = {
        process_code: code.trim(),
        process_name: name.trim(),
        category: category || null,
        unit: unit || null,
        unit_price: unitPrice,
        description: description || null,
        sort_order: sortOrder,
        is_active: isActive,
      };
      if (initial) {
        const { error: e } = await supabase.from("labor_rates").update(payload).eq("id", initial.id);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from("labor_rates").insert(payload);
        if (e) throw e;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const inputCls = "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-md"
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">{initial ? "공정 수정" : "공정 추가"}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>코드 *</label>
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="예: ELEC-001" className={inputCls + " font-mono"} />
            </div>
            <div>
              <label className={labelCls}>분류</label>
              <input value={category} onChange={e => setCategory(e.target.value)} lang="ko" placeholder="예: 전기" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>공정명 *</label>
            <input value={name} onChange={e => setName(e.target.value)} lang="ko" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>단위</label>
              <select value={unit} onChange={e => setUnit(e.target.value)} className={inputCls}>
                <option value="인공">인공</option>
                <option value="시간">시간</option>
                <option value="식">식</option>
                <option value="회">회</option>
                <option value="EA">EA</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>단가 (원)</label>
              <input type="text" inputMode="numeric" value={unitPrice === 0 ? "" : fmtNum(unitPrice)}
                onChange={e => setUnitPrice(parseNum(e.target.value))}
                className={inputCls + " text-right tabular-nums"} />
            </div>
          </div>
          <div>
            <label className={labelCls}>설명</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} lang="ko"
              className={inputCls + " resize-none"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>정렬 순서</label>
              <input type="text" inputMode="numeric" value={sortOrder} onChange={e => setSortOrder(parseNum(e.target.value))}
                className={inputCls + " text-right tabular-nums"} />
            </div>
            <div>
              <label className={labelCls}>활성 여부</label>
              <select value={isActive ? "Y" : "N"} onChange={e => setIsActive(e.target.value === "Y")} className={inputCls}>
                <option value="Y">활성</option>
                <option value="N">비활성</option>
              </select>
            </div>
          </div>

          {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-xs px-3 py-2 rounded">{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
    </DraggableModal>
  );
}
