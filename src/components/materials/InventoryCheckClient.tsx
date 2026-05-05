"use client";

import { useState, useEffect, useCallback } from "react";
import { MaterialRecord } from "@/lib/mock-materials";
import { MaterialUnitRecord } from "@/lib/mock-material-units";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { api, getErrorMessage } from "@/lib/api-client";
import { useRouter } from "next/navigation";

const PAGE_SIZE = 20;
type MatType = "전체" | "DS" | "TK";
type CheckMode = "qty" | "sn";

export default function InventoryCheckClient() {
  const [mode, setMode] = useState<CheckMode>("qty");
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [query, setQuery] = useState("");
  const [matType, setMatType] = useState<MatType>("전체");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actualQty, setActualQty] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // S/N 모드 상태
  const [units, setUnits] = useState<MaterialUnitRecord[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [confirmedUnits, setConfirmedUnits] = useState<Set<number>>(new Set());

  const { user } = useAuth();
  const router = useRouter();
  const { theme } = useTheme();

  // 관리자 권한 확인
  useEffect(() => {
    if (user && !isAdmin(user)) {
      alert("관리자만 접근할 수 있습니다.");
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    fetchMaterials();
  }, []);

  async function fetchMaterials() {
    setLoading(true);
    try {
      const data = await api.get<MaterialRecord[]>("/api/materials");
      setMaterials(data);
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const fetchUnits = useCallback(async () => {
    setUnitsLoading(true);
    try {
      const params = new URLSearchParams({ status: "재고" });
      if (query.trim()) params.set("matQuery", query.trim());
      const data = await api.get<MaterialUnitRecord[]>(`/api/material-units?${params.toString()}`);
      setUnits(data);
      setConfirmedUnits(new Set());
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setUnitsLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (mode !== "sn") return;
    const t = setTimeout(() => { fetchUnits(); }, 250);
    return () => clearTimeout(t);
  }, [mode, fetchUnits]);

  async function handleScrapUnchecked() {
    const toScrap = units.filter(u => !confirmedUnits.has(u.id));
    if (toScrap.length === 0) {
      alert("체크 안된 재고 unit이 없습니다.");
      return;
    }
    if (!confirm(`체크하지 않은 ${toScrap.length}건의 S/N unit을 '폐기' 처리하고 출고 트랜잭션으로 기록합니다.\n\n이 동작은 되돌릴 수 없습니다. 계속할까요?`)) return;
    setSaving(true);
    let ok = 0, fail = 0;
    try {
      for (const u of toScrap) {
        try {
          await api.post(`/api/material-units/${u.id}/scrap`, {
            userId: user?.id ?? 0,
            userName: user?.name ?? "시스템",
            note: "재고실사 손실",
          });
          ok++;
        } catch (e) {
          fail++;
          console.error(`scrap unit ${u.id} 실패`, e);
        }
      }
      alert(`폐기 처리: 성공 ${ok}건${fail ? ` / 실패 ${fail}건` : ""}`);
      await fetchUnits();
      await fetchMaterials();
    } finally {
      setSaving(false);
    }
  }

  function toggleUnitConfirmed(id: number) {
    setConfirmedUnits(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllUnitsConfirmed() {
    setConfirmedUnits(prev => {
      if (prev.size === units.length) return new Set();
      return new Set(units.map(u => u.id));
    });
  }

  const q = query.trim().toLowerCase();

  const filtered = materials.filter(m => {
    if (matType === "DS" && !m.id.startsWith("D")) return false;
    if (matType === "TK" &&  m.id.startsWith("D")) return false;
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
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
        paginated.forEach(m => {
          next.add(m.id);
          // 선택 시 현재 재고를 기본값으로 세팅
          setActualQty(q => ({ ...q, [m.id]: q[m.id] ?? m.stockQty }));
        });
        return next;
      });
    }
  }

  function toggleOne(id: string, currentStock: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setActualQty(q => ({ ...q, [id]: q[id] ?? currentStock }));
      }
      return next;
    });
  }

  function handleQtyChange(id: string, val: string) {
    const num = parseInt(val, 10);
    setActualQty(prev => ({ ...prev, [id]: isNaN(num) ? 0 : num }));
  }

  async function handleSave() {
    if (selected.size === 0) {
      alert("실사 반영할 자재를 선택해주세요.");
      return;
    }
    if (!confirm(`선택한 ${selected.size}개 자재의 재고를 실사 반영하시겠습니까?`)) return;

    setSaving(true);
    let successCount = 0;
    try {
      for (const id of selected) {
        const material = materials.find(m => m.id === id);
        if (!material) continue;

        const newQty = actualQty[id];
        const currentQty = material.stockQty;

        if (newQty === undefined || newQty === currentQty) {
          // 차이가 없으면 선택 해제만 하고 넘어감 (선택적)
          successCount++;
          continue;
        }

        const diff = newQty - currentQty;
        const type = diff > 0 ? "입고" : "출고";
        const absDiff = Math.abs(diff);

        // 1. 트랜잭션 기록
        await api.post("/api/transactions", {
          type,
          materialId: material.id,
          materialName: material.name,
          qty: absDiff,
          siteName: null,
          note: "재고실사 조정",
          userId: user?.id ?? 0,
          userName: user?.name ?? "시스템",
        });

        // 2. 재고 업데이트
        await api.patch(`/api/materials/${encodeURIComponent(material.id)}`, { stockQty: newQty });
        successCount++;
      }
      alert(`${successCount}건의 재고실사가 반영되었습니다.`);
      setSelected(new Set());
      setActualQty({});
      fetchMaterials();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const isDark = theme === "dark";

  return (
    <div className="space-y-4">
      {/* 모드 토글 */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-xl">
          <button type="button" onClick={() => setMode("qty")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === "qty" ? "bg-blue-600 text-white shadow-sm" : isDark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-700"}`}>
            📦 수량 모드
          </button>
          <button type="button" onClick={() => setMode("sn")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === "sn" ? "bg-purple-600 text-white shadow-sm" : isDark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-700"}`}>
            🏷️ S/N 모드
          </button>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {mode === "qty" ? "선택한 자재의 전산 재고 수량을 실사 결과로 일괄 보정" : "재고 상태 unit을 직접 확인 → 체크 안된 unit은 일괄 폐기 처리"}
        </span>
      </div>

      {/* 툴바 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap flex-1">
          {/* DS / TK 토글 (수량 모드 전용) */}
          {mode === "qty" && (
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl shrink-0">
            {(["전체", "DS", "TK"] as const).map(t => (
              <button key={t} type="button" onClick={() => { setMatType(t); resetPage(); }}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors
                  ${matType === t
                    ? t === "DS" ? "bg-red-500 text-white shadow-sm"
                      : t === "TK" ? "bg-blue-600 text-white shadow-sm"
                      : "bg-gray-900 text-white shadow-sm"
                    : isDark ? "text-gray-400 hover:text-gray-200" : "text-gray-400 hover:text-gray-600"}`}>
                {t}
              </button>
            ))}
          </div>
          )}

          {/* 검색 */}
          <div className="relative flex-1 min-w-48 max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); resetPage(); }}
              placeholder="부품명, 코드, 규격 검색"
              className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white dark:bg-gray-700"
            />
          </div>

          {/* 건수 */}
          <span className="text-sm text-gray-500 shrink-0">
            {mode === "qty"
              ? (q ? `검색 ${filtered.length.toLocaleString()}종` : `전체 ${materials.length.toLocaleString()}종`)
              : `재고 unit ${units.length.toLocaleString()}건 / 확인 ${confirmedUnits.size}건`
            }
          </span>
        </div>

        {mode === "qty" ? (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
              선택된 자재: {selected.size}개
            </span>
            <button
              onClick={handleSave}
              disabled={saving || selected.size === 0}
              className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "반영 중..." : "실사 반영"}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              미확인 {Math.max(0, units.length - confirmedUnits.size)}건
            </span>
            <button
              onClick={handleScrapUnchecked}
              disabled={saving || units.length === 0 || confirmedUnits.size === units.length}
              className="flex items-center gap-2 bg-red-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "처리 중..." : "체크 안된 unit 일괄 폐기"}
            </button>
          </div>
        )}
      </div>

      {/* 수량 모드 테이블 */}
      {mode === "qty" && (
      <div className={`rounded-xl border overflow-hidden transition-colors ${
        matType === "DS"
          ? isDark ? "bg-gray-900 border-red-700" : "bg-white border-red-300"
          : matType === "TK"
            ? isDark ? "bg-gray-900 border-blue-700" : "bg-white border-blue-300"
            : isDark ? "bg-gray-900 border-gray-700" : "bg-white border-gray-200"
      }`}>
        {loading && <div className="text-center py-4 text-sm text-gray-400">로딩 중...</div>}
        <div className="overflow-auto max-h-[calc(100vh-250px)]">
          <table className="w-full min-w-[800px] text-sm">
            <thead className={`sticky top-0 z-10 border-b transition-colors ${
              matType === "DS"
                ? isDark ? "bg-gray-800 border-red-800" : "bg-red-50 border-red-200"
                : matType === "TK"
                  ? isDark ? "bg-gray-800 border-blue-800" : "bg-blue-50 border-blue-200"
                  : isDark ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
            }`}>
              <tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = !allChecked && someChecked; }}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-gray-300 accent-slate-700 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">구분</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">자재코드</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">부품명</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">규격</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">보관장소</th>
                <th className="px-4 py-3 text-center font-medium text-gray-500 dark:text-gray-300">전산 재고</th>
                <th className="px-4 py-3 text-center font-bold text-blue-600 dark:text-blue-400">실사 재고</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? "divide-gray-700" : "divide-gray-100"}`}>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-16 text-gray-400">조회된 자재가 없습니다.</td></tr>
              ) : paginated.map(m => {
                const isChecked = selected.has(m.id);
                return (
                  <tr key={m.id}
                    onClick={() => toggleOne(m.id, m.stockQty)}
                    className={`transition-colors cursor-pointer ${isChecked ? isDark ? "bg-gray-700" : "bg-blue-50/50" : isDark ? "hover:bg-gray-800" : "hover:bg-gray-50"}`}>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isChecked} onChange={() => toggleOne(m.id, m.stockQty)}
                        className="w-4 h-4 rounded border-gray-300 accent-blue-600 cursor-pointer" />
                    </td>
                    <td className="px-4 py-3">
                      {m.isRepair
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300">수리품</span>
                        : <span className={`text-xs px-2 py-0.5 rounded-full ${
                            isDark
                              ? m.id.startsWith("D") ? "bg-red-900/60 text-red-300" : "bg-blue-900/60 text-blue-300"
                              : m.id.startsWith("D") ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
                          }`}>
                            {m.id.startsWith("D") ? "DS" : "TK"}
                          </span>
                      }
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{m.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{m.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{m.modelNo ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{m.storageLoc ?? "-"}</td>
                    <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-300 font-medium">{m.stockQty}</td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      {isChecked ? (
                        <input
                          type="number"
                          min={0}
                          value={actualQty[m.id] ?? ""}
                          onChange={e => handleQtyChange(m.id, e.target.value)}
                          className="w-20 rounded-md border border-blue-300 px-2 py-1 text-sm text-center font-bold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        />
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 dark:border-gray-700">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString()} / {filtered.length.toLocaleString()}종
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => changePage(safePage - 1)} disabled={safePage === 1}
                className="px-3 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
                ‹ 이전
              </button>
              {(() => {
                let start = Math.max(1, safePage - 2);
                const end = Math.min(totalPages, start + 4);
                if (end - start < 4) start = Math.max(1, end - 4);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                  <button key={p} onClick={() => changePage(p)}
                    className={`min-w-[32px] px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                      p === safePage
                        ? "bg-slate-700 text-white"
                        : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}>
                    {p}
                  </button>
                ));
              })()}
              <button onClick={() => changePage(safePage + 1)} disabled={safePage === totalPages}
                className="px-3 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
                다음 ›
              </button>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">{safePage} / {totalPages} 페이지</span>
          </div>
        )}
      </div>
      )}

      {/* S/N 모드 테이블 */}
      {mode === "sn" && (
      <div className={`rounded-xl border overflow-hidden ${isDark ? "bg-gray-900 border-purple-800" : "bg-white border-purple-200"}`}>
        {unitsLoading && <div className="text-center py-4 text-sm text-gray-400">로딩 중...</div>}
        <div className="overflow-auto max-h-[calc(100vh-260px)]">
          <table className="w-full min-w-[840px] text-sm">
            <thead className={`sticky top-0 z-10 border-b ${isDark ? "bg-gray-800 border-purple-900" : "bg-purple-50 border-purple-200"}`}>
              <tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox"
                    checked={units.length > 0 && confirmedUnits.size === units.length}
                    ref={el => { if (el) el.indeterminate = confirmedUnits.size > 0 && confirmedUnits.size < units.length; }}
                    onChange={toggleAllUnitsConfirmed}
                    className="w-4 h-4 rounded border-gray-300 accent-purple-600 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">S/N</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">자재명</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">자재코드</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">규격</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-300">입고일</th>
                <th className="px-4 py-3 text-center font-bold text-purple-600 dark:text-purple-400">물리적 확인</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? "divide-gray-700" : "divide-gray-100"}`}>
              {units.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-16 text-gray-400">재고 상태인 S/N unit이 없습니다.</td></tr>
              ) : units.map(u => {
                const isConfirmed = confirmedUnits.has(u.id);
                return (
                  <tr key={u.id}
                    onClick={() => toggleUnitConfirmed(u.id)}
                    className={`transition-colors cursor-pointer ${isConfirmed ? isDark ? "bg-emerald-900/30" : "bg-emerald-50/50" : isDark ? "hover:bg-gray-800" : "hover:bg-gray-50"}`}>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isConfirmed} onChange={() => toggleUnitConfirmed(u.id)}
                        className="w-4 h-4 rounded border-gray-300 accent-emerald-600 cursor-pointer" />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-800 dark:text-gray-200 whitespace-nowrap">{u.serialNo}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 max-w-[220px] truncate">{u.materialName ?? "-"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{u.materialId}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.materialModelNo ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{u.inboundAt.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-center">
                      {isConfirmed ? (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 font-semibold">✓ 확인</span>
                      ) : (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">미확인</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
