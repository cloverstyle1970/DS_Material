"use client";

import { Fragment, useEffect, useState } from "react";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";
import { fmtNum } from "@/lib/format";
import * as XLSX from "xlsx";

const MENU_HREF = "/quotes/labor-rates";

interface LaborCat {
  id: number;
  level: "major" | "mid";
  label: string;
  parent_id: number | null;
  sort_order: number;
  is_active: boolean;
}
interface WorkloadStd {
  id: number;
  major_id: number | null;
  mid_id: number | null;
  detail: string | null;     // 보조구분·층수 통합 (소분류)
  man_days: number | null;   // 공수 (NULL = 별도 견적)
  is_active: boolean;
  sort_order: number;
  note: string | null;
}

function parseManDays(s: string): number | null {
  const v = s.replace(/[^0-9.]/g, "");
  if (v === "" || v === ".") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function LaborRatesClient() {
  const { user } = useAuth();
  const [cats, setCats] = useState<LaborCat[]>([]);
  const [rows, setRows] = useState<WorkloadStd[]>([]);
  const [baseLabor, setBaseLabor] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [editing, setEditing] = useState<WorkloadStd | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  async function load() {
    setLoading(true);
    const [cat, std, settings] = await Promise.all([
      supabase.from("labor_categories").select("*").order("sort_order").order("id"),
      supabase.from("labor_workload_standards").select("id, major_id, mid_id, detail, man_days, is_active, sort_order, note").order("sort_order").order("id"),
      supabase.from("quote_settings").select("default_direct_labor").limit(1).maybeSingle(),
    ]);
    setCats((cat.data ?? []) as LaborCat[]);
    setRows((std.data ?? []) as WorkloadStd[]);
    setBaseLabor(Number(settings.data?.default_direct_labor ?? 0));
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

  // 분류 조회 헬퍼
  const catById = new Map(cats.map(c => [c.id, c]));
  const majors = cats.filter(c => c.level === "major");
  const labelOf = (id: number | null) => (id != null ? catById.get(id)?.label ?? "" : "");
  const itemLabel = (r: WorkloadStd) => [labelOf(r.major_id), labelOf(r.mid_id), r.detail].filter(Boolean).join(" · ");

  const filtered = rows
    .filter(r => activeFilter === "all" ? true : activeFilter === "active" ? r.is_active : !r.is_active)
    .filter(r => {
      if (!search.trim()) return true;
      const s = search.trim().toLowerCase();
      return itemLabel(r).toLowerCase().includes(s) || (r.note ?? "").toLowerCase().includes(s);
    });

  // 대분류별 그룹 (majors 정렬 순서 유지)
  const groups = majors
    .map(m => ({ major: m, items: filtered.filter(r => r.major_id === m.id) }))
    .filter(g => g.items.length > 0 || (!search.trim() && activeFilter !== "inactive"));
  const ungrouped = filtered.filter(r => r.major_id == null);

  const searching = search.trim() !== "";
  const allCollapsed = groups.length > 0 && groups.every(g => collapsed.has(g.major.id));
  function toggleGroup(id: number) {
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setCollapsed(allCollapsed ? new Set() : new Set(groups.map(g => g.major.id)));
  }

  async function deleteRow(r: WorkloadStd) {
    if (!admin) return;
    if (!confirm(`"${itemLabel(r)}" 공수 항목을 삭제하시겠습니까?`)) return;
    const { error } = await supabase.from("labor_workload_standards").delete().eq("id", r.id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    await load();
  }
  async function toggleActive(r: WorkloadStd) {
    if (!canUpdate) return;
    const { error } = await supabase.from("labor_workload_standards").update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) { alert(`변경 실패: ${error.message}`); return; }
    await load();
  }

  function downloadXlsx() {
    const header = ["대분류", "중분류", "소분류(상세)", "공수", "예상인건비", "비고", "활성", "정렬"];
    const body = filtered.map(r => [
      labelOf(r.major_id),
      labelOf(r.mid_id),
      r.detail ?? "",
      r.man_days ?? "별도견적",
      r.man_days == null ? "별도견적" : r.man_days * baseLabor,
      r.note ?? "",
      r.is_active ? "활성" : "비활성",
      r.sort_order,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 8 }, { wch: 12 }, { wch: 24 }, { wch: 8 }, { wch: 6 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "공수표");
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(wb, `공정별공수표_${ts}.xlsx`);
  }

  function renderItemRow(r: WorkloadStd) {
    return (
      <tr key={r.id} className={`text-center hover:bg-gray-50 dark:hover:bg-gray-700/30 ${!r.is_active ? "opacity-60" : ""}`}>
        <td className="px-3 py-2.5 text-xs text-gray-700 dark:text-gray-200 text-left pl-8">{labelOf(r.mid_id) || "-"}</td>
        <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400 text-left">{r.detail || "-"}</td>
        <td className="px-3 py-2.5 text-xs font-bold tabular-nums">
          {r.man_days == null
            ? <span className="text-amber-500">별도견적</span>
            : <span className="text-gray-800 dark:text-gray-100">{r.man_days}공</span>}
        </td>
        <td className="px-3 py-2.5 text-xs tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
          {r.man_days == null ? "-" : `${fmtNum(Math.round(r.man_days * baseLabor))}원`}
        </td>
        <td className="px-3 py-2.5 text-xs text-gray-500 max-w-xs truncate text-left">{r.note ?? "-"}</td>
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
    );
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">공정별 공수표</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">
          대분류·중분류로 분류된 표준 공수 — 견적 작성에서 대→중→항목 순으로 선택
        </p>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-900/40 px-6 py-2.5 text-xs text-blue-800 dark:text-blue-200">
        💡 인건비 = <b>공수 × 기본 직접인건비</b>
        <span className="ml-1 font-bold tabular-nums">{fmtNum(baseLabor)}원</span>
        <span className="text-blue-500 dark:text-blue-400 ml-1">(견적 기본설정값 · 견적별로 조정 가능)</span>
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
          placeholder="분류·상세·비고 검색"
          className="flex-1 max-w-md px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs" />
        {!searching && groups.length > 0 && (
          <button type="button" onClick={toggleAll}
            className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-700">
            {allCollapsed ? "▼ 전체 펼치기" : "▶ 전체 접기"}
          </button>
        )}
        <button type="button" onClick={downloadXlsx} disabled={filtered.length === 0}
          className="ml-auto px-3 py-1.5 rounded bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
          📥 엑셀 다운로드 ({filtered.length})
        </button>
        {canUpdate && (
          <button type="button" onClick={() => setShowCatMgr(true)}
            className="px-3 py-1.5 rounded bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700">📂 분류 관리</button>
        )}
        {canCreate && (
          <button type="button" onClick={() => setShowNew(true)}
            className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">+ 공수 추가</button>
        )}
      </div>

      <div className="px-6 py-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr className="text-center text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  <th className="px-3 py-2.5 text-left">중분류</th>
                  <th className="px-3 py-2.5 text-left">소분류 (상세)</th>
                  <th className="px-3 py-2.5">공수</th>
                  <th className="px-3 py-2.5">예상 인건비</th>
                  <th className="px-3 py-2.5">비고</th>
                  <th className="px-3 py-2.5">활성</th>
                  <th className="px-3 py-2.5">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && <tr><td colSpan={7} className="text-center py-8 text-xs text-gray-500">로딩 중...</td></tr>}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-12 text-xs text-gray-500">등록된 공수 항목이 없습니다.</td></tr>
                )}
                {!loading && groups.map(g => {
                  const open = searching || !collapsed.has(g.major.id);
                  const manSum = g.items.reduce((s, i) => s + (i.man_days || 0), 0);
                  return (
                    <Fragment key={g.major.id}>
                      <tr className="bg-gray-100 dark:bg-gray-700/60 border-y border-gray-200 dark:border-gray-600 cursor-pointer select-none"
                        onClick={() => !searching && toggleGroup(g.major.id)}>
                        <td colSpan={7} className="px-3 py-2 text-left">
                          <span className="inline-block w-4 text-gray-400">{searching ? "•" : (open ? "▼" : "▶")}</span>
                          <span className="text-[10px] font-semibold text-gray-400 mr-1">대분류</span>
                          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{g.major.label}</span>
                          <span className="ml-2 text-[11px] font-normal text-gray-500 dark:text-gray-400">
                            {g.items.length}건{g.items.length ? ` · 공수합 ${manSum}공` : ""}
                          </span>
                        </td>
                      </tr>
                      {open && g.items.map(renderItemRow)}
                    </Fragment>
                  );
                })}
                {!loading && ungrouped.length > 0 && (
                  <Fragment>
                    <tr className="bg-amber-50 dark:bg-amber-900/20 border-y border-amber-200 dark:border-amber-800">
                      <td colSpan={7} className="px-3 py-2 text-left text-xs font-bold text-amber-700 dark:text-amber-300">⚠ 분류 미지정 항목</td>
                    </tr>
                    {ungrouped.map(renderItemRow)}
                  </Fragment>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(showNew || editing) && (
        <WorkloadModal
          initial={editing}
          cats={cats}
          baseLabor={baseLabor}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={() => { setShowNew(false); setEditing(null); load(); }}
        />
      )}
      {showCatMgr && (
        <LaborCategoryManager
          cats={cats}
          canCreate={canCreate}
          admin={admin}
          onClose={() => setShowCatMgr(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ============================================================
// 공수 항목 등록/수정 모달
// ============================================================

function WorkloadModal({
  initial, cats, baseLabor, onClose, onSaved,
}: {
  initial: WorkloadStd | null;
  cats: LaborCat[];
  baseLabor: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [majorId, setMajorId]     = useState<number | null>(initial?.major_id ?? null);
  const [midId, setMidId]         = useState<number | null>(initial?.mid_id ?? null);
  const [detail, setDetail]       = useState(initial?.detail ?? "");
  const [manDaysStr, setManDaysStr] = useState(initial?.man_days == null ? "" : String(initial.man_days));
  const [note, setNote]           = useState(initial?.note ?? "");
  const [sortOrder, setSortOrder] = useState<number>(initial?.sort_order ?? 0);
  const [isActive, setIsActive]   = useState<boolean>(initial?.is_active ?? true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  const majors = cats.filter(c => c.level === "major" && c.is_active);
  const mids = cats.filter(c => c.level === "mid" && c.parent_id === majorId);
  const manDays = parseManDays(manDaysStr);

  async function save() {
    setError("");
    if (majorId == null) { setError("대분류는 필수입니다."); return; }
    setSaving(true);
    try {
      const majorLabel = cats.find(c => c.id === majorId)?.label ?? "";
      const midLabel = cats.find(c => c.id === midId)?.label ?? null;
      const payload = {
        major_id: majorId,
        mid_id: midId,
        detail: detail.trim() || null,
        man_days: manDays,
        note: note.trim() || (manDays == null ? "별도 견적" : null),
        sort_order: sortOrder,
        is_active: isActive,
        // 레거시 텍스트 컬럼 동기화 (category NOT NULL)
        category: majorLabel,
        type_name: midLabel,
      };
      if (initial) {
        const { error: e } = await supabase.from("labor_workload_standards").update(payload).eq("id", initial.id);
        if (e) throw e;
      } else {
        const { error: e } = await supabase.from("labor_workload_standards").insert(payload);
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
          <div className="text-base font-bold text-gray-900 dark:text-white">{initial ? "공수 항목 수정" : "공수 항목 추가"}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>대분류 *</label>
              <select value={majorId ?? ""} onChange={e => { setMajorId(e.target.value ? Number(e.target.value) : null); setMidId(null); }} className={inputCls}>
                <option value="">선택</option>
                {majors.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>중분류</label>
              <select value={midId ?? ""} onChange={e => setMidId(e.target.value ? Number(e.target.value) : null)} disabled={majorId == null} className={inputCls + (majorId == null ? " opacity-50" : "")}>
                <option value="">선택</option>
                {mids.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-1">분류가 없으면 상단 [📂 분류 관리]에서 먼저 추가하세요.</p>
          <div>
            <label className={labelCls}>소분류 / 상세 <span className="text-[10px] text-gray-400">(예: MR · 30층 이상, 부하 &amp; 반부하측)</span></label>
            <input value={detail} onChange={e => setDetail(e.target.value)} lang="ko" placeholder="없으면 비워두세요" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>공수 <span className="text-[10px] text-gray-400">(빈칸=별도견적)</span></label>
              <input type="text" inputMode="decimal" value={manDaysStr}
                onChange={e => setManDaysStr(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="예: 4" className={inputCls + " text-right tabular-nums"} />
              <div className="text-[11px] text-gray-500 mt-1">
                {manDays == null ? "별도 견적" : `${manDays}공 × ${fmtNum(baseLabor)}원 = ${fmtNum(Math.round(manDays * baseLabor))}원`}
              </div>
            </div>
            <div>
              <label className={labelCls}>정렬 순서</label>
              <input type="text" inputMode="numeric" value={sortOrder}
                onChange={e => setSortOrder(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
                className={inputCls + " text-right tabular-nums"} />
            </div>
          </div>
          <div>
            <label className={labelCls}>비고</label>
            <input value={note} onChange={e => setNote(e.target.value)} lang="ko" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>활성 여부</label>
            <select value={isActive ? "Y" : "N"} onChange={e => setIsActive(e.target.value === "Y")} className={inputCls}>
              <option value="Y">활성</option>
              <option value="N">비활성</option>
            </select>
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

// ============================================================
// 분류(대/중) 관리 모달
// ============================================================

function LaborCategoryManager({
  cats, canCreate, admin, onClose, onChanged,
}: {
  cats: LaborCat[];
  canCreate: boolean;
  admin: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [newMajor, setNewMajor] = useState("");
  const [newMidFor, setNewMidFor] = useState<number | null>(null);
  const [newMidLabel, setNewMidLabel] = useState("");
  const [openMajors, setOpenMajors] = useState<Set<number>>(new Set());

  const majors = cats.filter(c => c.level === "major");
  const midsOf = (mid: number) => cats.filter(c => c.level === "mid" && c.parent_id === mid);

  function toggle(id: number) {
    setOpenMajors(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function addMajor() {
    if (!newMajor.trim()) return;
    setBusy(true);
    const maxSort = Math.max(0, ...majors.map(m => m.sort_order));
    const { error } = await supabase.from("labor_categories").insert({ level: "major", label: newMajor.trim(), sort_order: maxSort + 10 });
    setBusy(false);
    if (error) { alert(`추가 실패: ${error.message}`); return; }
    setNewMajor(""); onChanged();
  }
  async function addMid(majorId: number) {
    if (!newMidLabel.trim()) return;
    setBusy(true);
    const maxSort = Math.max(0, ...midsOf(majorId).map(m => m.sort_order));
    const { error } = await supabase.from("labor_categories").insert({ level: "mid", label: newMidLabel.trim(), parent_id: majorId, sort_order: maxSort + 10 });
    setBusy(false);
    if (error) { alert(`추가 실패: ${error.message}`); return; }
    setNewMidLabel(""); setNewMidFor(null); onChanged();
  }
  // 이름 변경 시 항목의 레거시 텍스트 컬럼(category/type_name)도 전파
  async function rename(c: LaborCat, label: string) {
    if (!label.trim() || label === c.label) return;
    setBusy(true);
    const { error } = await supabase.from("labor_categories").update({ label: label.trim() }).eq("id", c.id);
    if (!error) {
      if (c.level === "major") await supabase.from("labor_workload_standards").update({ category: label.trim() }).eq("major_id", c.id);
      else await supabase.from("labor_workload_standards").update({ type_name: label.trim() }).eq("mid_id", c.id);
    }
    setBusy(false);
    if (error) { alert(`수정 실패: ${error.message}`); return; }
    onChanged();
  }
  async function remove(c: LaborCat) {
    if (!admin) return;
    const msg = c.level === "major"
      ? `"${c.label}" 대분류를 삭제하면 하위 중분류도 함께 삭제됩니다. 이 분류를 쓰는 공수 항목이 있으면 삭제할 수 없습니다. 계속할까요?`
      : `"${c.label}" 중분류를 삭제하시겠습니까? 이 분류를 쓰는 공수 항목이 있으면 삭제할 수 없습니다.`;
    if (!confirm(msg)) return;
    setBusy(true);
    const { error } = await supabase.from("labor_categories").delete().eq("id", c.id);
    setBusy(false);
    if (error) { alert(`삭제 실패 — 사용 중인 분류일 수 있습니다.\n${error.message}`); return; }
    onChanged();
  }
  async function move(c: LaborCat, dir: -1 | 1) {
    const siblings = (c.level === "major" ? majors : midsOf(c.parent_id!)).slice().sort((a, b) => a.sort_order - b.sort_order);
    const idx = siblings.findIndex(s => s.id === c.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    setBusy(true);
    await supabase.from("labor_categories").update({ sort_order: swap.sort_order }).eq("id", c.id);
    await supabase.from("labor_categories").update({ sort_order: c.sort_order }).eq("id", swap.id);
    setBusy(false);
    onChanged();
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-lg"
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">📂 공수 분류 관리 (대/중분류)</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
      <div className="p-5 max-h-[65vh] overflow-y-auto">
        {canCreate && (
          <div className="flex gap-2 mb-3">
            <input value={newMajor} onChange={e => setNewMajor(e.target.value)} lang="ko"
              onKeyDown={e => { if (e.key === "Enter") addMajor(); }}
              placeholder="새 대분류명" className="flex-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm" />
            <button type="button" onClick={addMajor} disabled={busy || !newMajor.trim()}
              className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50">+ 대분류</button>
          </div>
        )}
        <div className="space-y-1">
          {majors.map(maj => {
            const open = openMajors.has(maj.id);
            const mids = midsOf(maj.id);
            return (
              <div key={maj.id} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 dark:bg-gray-700/50 rounded-t-lg">
                  <button type="button" onClick={() => toggle(maj.id)} className="w-5 text-gray-400">{open ? "▼" : "▶"}</button>
                  <CatLabel c={maj} canUpdate={canCreate} onRename={rename} />
                  <span className="text-[10px] text-gray-400">({mids.length})</span>
                  <div className="ml-auto flex items-center gap-0.5">
                    <button type="button" onClick={() => move(maj, -1)} className="text-gray-300 hover:text-gray-600 px-1">↑</button>
                    <button type="button" onClick={() => move(maj, 1)} className="text-gray-300 hover:text-gray-600 px-1">↓</button>
                    {admin && <button type="button" onClick={() => remove(maj)} className="text-red-300 hover:text-red-600 px-1 text-xs">삭제</button>}
                  </div>
                </div>
                {open && (
                  <div className="px-2 py-1.5 space-y-0.5">
                    {mids.map(mid => (
                      <div key={mid.id} className="flex items-center gap-1 pl-6 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700/40 group">
                        <CatLabel c={mid} canUpdate={canCreate} onRename={rename} />
                        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                          <button type="button" onClick={() => move(mid, -1)} className="text-gray-300 hover:text-gray-600 px-1">↑</button>
                          <button type="button" onClick={() => move(mid, 1)} className="text-gray-300 hover:text-gray-600 px-1">↓</button>
                          {admin && <button type="button" onClick={() => remove(mid)} className="text-red-300 hover:text-red-600 px-1 text-xs">삭제</button>}
                        </div>
                      </div>
                    ))}
                    {canCreate && (
                      newMidFor === maj.id ? (
                        <div className="flex gap-2 pl-6 py-1">
                          <input autoFocus value={newMidLabel} onChange={e => setNewMidLabel(e.target.value)} lang="ko"
                            onKeyDown={e => { if (e.key === "Enter") addMid(maj.id); if (e.key === "Escape") { setNewMidFor(null); setNewMidLabel(""); } }}
                            placeholder="새 중분류명" className="flex-1 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs" />
                          <button type="button" onClick={() => addMid(maj.id)} disabled={busy} className="text-xs text-green-600 font-semibold">추가</button>
                          <button type="button" onClick={() => { setNewMidFor(null); setNewMidLabel(""); }} className="text-xs text-gray-400">취소</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => { setNewMidFor(maj.id); setNewMidLabel(""); }}
                          className="ml-6 text-[11px] text-blue-500 hover:text-blue-700">+ 중분류 추가</button>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">닫기</button>
      </div>
    </DraggableModal>
  );
}

function CatLabel({ c, canUpdate, onRename }: { c: LaborCat; canUpdate: boolean; onRename: (c: LaborCat, label: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.label);
  if (editing) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} lang="ko"
        onBlur={() => { setEditing(false); onRename(c, draft); }}
        onKeyDown={e => { if (e.key === "Enter") { setEditing(false); onRename(c, draft); } if (e.key === "Escape") { setDraft(c.label); setEditing(false); } }}
        className="px-2 py-0.5 rounded border border-blue-300 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm w-44" />
    );
  }
  return (
    <span className={`text-sm text-gray-800 dark:text-gray-100 ${canUpdate ? "cursor-pointer hover:underline" : ""}`}
      onClick={() => canUpdate && setEditing(true)} title={canUpdate ? "클릭하여 이름 수정" : ""}>
      {c.label}
    </span>
  );
}
