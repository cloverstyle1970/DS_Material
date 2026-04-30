"use client";

import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { MaterialRecord } from "@/lib/mock-materials";
import AddMaterialModal from "./AddMaterialModal";
import EditMaterialModal from "./EditMaterialModal";
import { useAuth, isViewOnly } from "@/context/AuthContext";

const LOW_STOCK_THRESHOLD = 5;

function StockCell({ material, editable }: { material: MaterialRecord; editable: boolean }) {
  const [qty, setQty] = useState(material.stockQty);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(qty);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/materials/${encodeURIComponent(material.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stockQty: draft }),
    });
    setQty(draft);
    setSaving(false);
    setEditing(false);
  }

  if (editable && editing) {
    return (
      <div className="flex items-center gap-1">
        <input type="number" min={0} value={draft} onChange={e => setDraft(Number(e.target.value))}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-slate-400" />
        <button onClick={save} disabled={saving} className="text-xs text-green-600 hover:text-green-800 font-medium">저장</button>
        <button onClick={() => { setDraft(qty); setEditing(false); }} className="text-xs text-gray-400 hover:text-gray-600">취소</button>
      </div>
    );
  }

  return (
    <span
      onClick={() => editable && setEditing(true)}
      className={`${qty === 0 ? "text-red-600" : qty <= LOW_STOCK_THRESHOLD ? "text-orange-500" : "text-gray-700"} ${editable ? "cursor-pointer group" : ""} flex items-center gap-1.5`}
    >
      <span className="font-medium">{qty}</span>
      {editable && <span className="text-gray-300 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✏️</span>}
    </span>
  );
}

const PAGE_SIZE = 20;

type MatType = "전체" | "DS" | "TK";

export default function MaterialsClient({ initial }: { initial: MaterialRecord[] }) {
  const [materials, setMaterials] = useState(initial);
  const [query, setQuery] = useState("");
  const [matType, setMatType] = useState<MatType>("전체");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<MaterialRecord | null>(null);
  const [loading, setLoading] = useState(false);

  const { user } = useAuth();
  const viewOnly = user ? isViewOnly(user) : false;

  const q = query.trim().toLowerCase();

  const filtered = materials.filter(m => {
    if (matType === "DS" && !m.id.startsWith("D")) return false;
    if (matType === "TK" &&  m.id.startsWith("D")) return false;
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      (m.alias?.toLowerCase().includes(q) ?? false) ||
      (m.modelNo?.toLowerCase().includes(q) ?? false) ||
      (m.storageLoc?.toLowerCase().includes(q) ?? false)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function changePage(next: number) {
    setPage(Math.max(1, Math.min(next, totalPages)));
  }
  function resetPage() { setPage(1); }

  const allChecked  = paginated.length > 0 && paginated.every(m => selected.has(m.id));
  const someChecked = paginated.some(m => selected.has(m.id));

  function toggleAll() {
    if (allChecked) {
      setSelected(prev => {
        const next = new Set(prev);
        paginated.forEach(m => next.delete(m.id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        paginated.forEach(m => next.add(m.id));
        return next;
      });
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function downloadExcel() {
    const list = q ? filtered : materials;
    const rows = list.map(m => {
      const base: Record<string, string | number | null> = {
        구분: m.isRepair ? "수리품" : m.id.startsWith("D") ? "DS" : "TK",
        자재코드: m.id,
        부품명: m.name,
        별칭: m.alias ?? "",
        기종명: m.modelNo ?? "",
        단위: m.unit ?? "",
        판매단가: m.sellPrice ?? "",
        보관장소: m.storageLoc ?? "",
        재고: m.stockQty,
      };
      if (!viewOnly) base["구매단가"] = m.buyPrice ?? "";
      return base;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "자재목록");

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const label = q ? `검색결과_${q}` : "전체자재";
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `자재목록_${label}_${stamp}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/materials");
    setMaterials(await res.json());
    setLoading(false);
    setShowModal(false);
  }, []);

  const headers = viewOnly
    ? ["", "구분", "자재코드", "부품명", "별칭", "기종명", "단위", "판매단가", "보관장소", "재고"]
    : ["", "구분", "자재코드", "부품명", "별칭", "기종명", "단위", "구매단가", "판매단가", "보관장소", "재고", ""];
  const colSpan = headers.length;

  return (
    <>
      {/* 툴바 */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-3 flex-wrap">
          {/* DS / TK 토글 */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl shrink-0">
            {(["전체", "DS", "TK"] as const).map(t => (
              <button key={t} type="button" onClick={() => { setMatType(t); setSelected(new Set()); resetPage(); }}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors
                  ${matType === t
                    ? t === "DS" ? "bg-slate-700 text-white shadow-sm"
                      : t === "TK" ? "bg-blue-600 text-white shadow-sm"
                      : "bg-white text-gray-700 shadow-sm"
                    : "text-gray-400 hover:text-gray-600"}`}>
                {t}
              </button>
            ))}
          </div>

          {/* 검색 */}
          <div className="relative flex-1 min-w-48">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); resetPage(); }}
              placeholder="부품명, 코드, 별칭, 기종명, 보관장소 검색"
              className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
            />
            {query && (
              <button type="button" onClick={() => { setQuery(""); resetPage(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            )}
          </div>

          {/* 건수 */}
          <span className="text-sm text-gray-500 shrink-0">
            {q
              ? `검색 ${filtered.length.toLocaleString()}종`
              : matType !== "전체"
                ? `${matType} ${filtered.length.toLocaleString()}종`
                : `전체 ${materials.length.toLocaleString()}종`}
            {selected.size > 0 && <span className="ml-2 text-slate-600 font-medium">(선택 {selected.size}개)</span>}
          </span>

          {/* 선택 해제 */}
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())}
              className="text-xs text-gray-400 hover:text-gray-600 underline shrink-0">
              선택 해제
            </button>
          )}

          <button type="button" onClick={downloadExcel}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-green-700 transition-colors shrink-0">
            엑셀 다운로드
          </button>

          {!viewOnly && (
            <button type="button" onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-slate-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shrink-0">
              + 자재 등록
            </button>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading && <div className="text-center py-4 text-sm text-gray-400">로딩 중...</div>}
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {/* 전체 선택 체크박스 */}
              <th className="px-4 py-3 w-8">
                <input type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = !allChecked && someChecked; }}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded border-gray-300 accent-slate-700 cursor-pointer"
                />
              </th>
              {headers.slice(1).map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <tr><td colSpan={colSpan} className="text-center py-16 text-gray-400">
                {q ? "검색 결과가 없습니다" : "등록된 자재가 없습니다"}
              </td></tr>
            ) : paginated.map(m => {
              const isChecked = selected.has(m.id);
              return (
                <tr key={m.id}
                  onClick={() => toggleOne(m.id)}
                  className={`transition-colors cursor-pointer ${isChecked ? "bg-slate-50" : "hover:bg-gray-50"}`}>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isChecked} onChange={() => toggleOne(m.id)}
                      className="w-4 h-4 rounded border-gray-300 accent-slate-700 cursor-pointer" />
                  </td>
                  <td className="px-4 py-3">
                    {m.isRepair
                      ? <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">수리품</span>
                      : <span className={`text-xs px-2 py-0.5 rounded-full ${m.id.startsWith("D") ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                          {m.id.startsWith("D") ? "DS" : "TK"}
                        </span>
                    }
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">{m.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{m.name}</td>
                  <td className="px-4 py-3 text-gray-500">{m.alias ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-500">{m.modelNo ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-500">{m.unit ?? "-"}</td>
                  {!viewOnly && (
                    <td className="px-4 py-3 text-gray-500 text-right tabular-nums">
                      {m.buyPrice != null ? m.buyPrice.toLocaleString() : "-"}
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-700 text-right tabular-nums font-medium">
                    {m.sellPrice != null ? m.sellPrice.toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{m.storageLoc ?? "-"}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <StockCell material={m} editable={!viewOnly} />
                  </td>
                  {!viewOnly && (
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setEditTarget(m)}
                        className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-slate-50 hover:text-slate-700 hover:border-slate-300 transition-colors whitespace-nowrap"
                      >
                        수정
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60">
            <span className="text-xs text-gray-500">
              {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString()} / {filtered.length.toLocaleString()}종
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => changePage(1)} disabled={safePage === 1}
                className="px-2 py-1.5 rounded text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                «
              </button>
              <button onClick={() => changePage(safePage - 1)} disabled={safePage === 1}
                className="px-3 py-1.5 rounded text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                ‹ 이전
              </button>

              {/* 페이지 번호 버튼 (최대 5개) */}
              {(() => {
                const half  = 2;
                let start = Math.max(1, safePage - half);
                let end   = Math.min(totalPages, start + 4);
                if (end - start < 4) start = Math.max(1, end - 4);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                  <button key={p} onClick={() => changePage(p)}
                    className={`min-w-[32px] px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                      p === safePage
                        ? "bg-slate-700 text-white"
                        : "text-gray-600 hover:bg-gray-200"
                    }`}>
                    {p}
                  </button>
                ));
              })()}

              <button onClick={() => changePage(safePage + 1)} disabled={safePage === totalPages}
                className="px-3 py-1.5 rounded text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                다음 ›
              </button>
              <button onClick={() => changePage(totalPages)} disabled={safePage === totalPages}
                className="px-2 py-1.5 rounded text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                »
              </button>
            </div>
            <span className="text-xs text-gray-400">{safePage} / {totalPages} 페이지</span>
          </div>
        )}
      </div>

      {showModal && <AddMaterialModal onClose={() => setShowModal(false)} onSaved={reload} />}
      {editTarget && (
        <EditMaterialModal
          material={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); reload(); }}
        />
      )}
    </>
  );
}
