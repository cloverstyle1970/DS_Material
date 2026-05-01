"use client";

import { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { api } from "@/lib/api-client";

interface Transaction {
  id: number;
  type: string;
  materialId: string;
  materialName: string;
  qty: number;
  createdAt: string;
  siteName: string | null;
  userName: string;
  unitPrice?: number | null;
}

type ViewMode = "monthly" | "quarterly" | "yearly";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

function getMonthLabel(month: number) {
  return `${month}월`;
}
function getQuarterLabel(q: number) {
  return `Q${q}`;
}

function periodKey(date: string, mode: ViewMode) {
  const d = new Date(date);
  if (mode === "monthly")   return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (mode === "quarterly") return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
  return `${d.getFullYear()}`;
}

function generatePeriodLabels(year: number, mode: ViewMode): string[] {
  if (mode === "monthly")   return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  if (mode === "quarterly") return [1, 2, 3, 4].map(q => `${year}-Q${q}`);
  return YEARS.map(y => `${y}`);
}

function periodDisplay(key: string, mode: ViewMode) {
  if (mode === "monthly") {
    const [, m] = key.split("-");
    return getMonthLabel(Number(m));
  }
  if (mode === "quarterly") {
    const [, q] = key.split("-");
    return getQuarterLabel(Number(q.replace("Q", "")));
  }
  return key;
}

export default function PeriodStatsClient() {
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");
  const [year, setYear]         = useState(CURRENT_YEAR);
  const [showChart, setShowChart] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<Transaction[]>("/api/transactions")
      .then(data => setTransactions(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const periods = useMemo(() => generatePeriodLabels(year, viewMode), [year, viewMode]);

  const filteredTx = useMemo(() => {
    if (viewMode === "yearly") return transactions;
    return transactions.filter(t => {
      const d = new Date(t.createdAt);
      return d.getFullYear() === year;
    });
  }, [transactions, year, viewMode]);

  const periodSummary = useMemo(() => {
    const map: Record<string, { inbound: number; outbound: number; inQty: number; outQty: number }> = {};
    periods.forEach(p => { map[p] = { inbound: 0, outbound: 0, inQty: 0, outQty: 0 }; });
    filteredTx.forEach(t => {
      const key = periodKey(t.createdAt, viewMode);
      if (!map[key]) return;
      if (t.type === "입고") {
        map[key].inbound += (t.unitPrice ?? 0) * t.qty;
        map[key].inQty   += t.qty;
      } else {
        map[key].outbound += (t.unitPrice ?? 0) * t.qty;
        map[key].outQty   += t.qty;
      }
    });
    return map;
  }, [filteredTx, periods, viewMode]);

  const totalInQty  = filteredTx.filter(t => t.type === "입고").reduce((s, t) => s + t.qty, 0);
  const totalOutQty = filteredTx.filter(t => t.type === "출고").reduce((s, t) => s + t.qty, 0);
  const totalInAmt  = filteredTx.filter(t => t.type === "입고").reduce((s, t) => s + (t.unitPrice ?? 0) * t.qty, 0);
  const totalOutAmt = filteredTx.filter(t => t.type === "출고").reduce((s, t) => s + (t.unitPrice ?? 0) * t.qty, 0);

  // 피벗 테이블: 자재별 × 기간별
  const pivotData = useMemo(() => {
    const map: Record<string, { id: string; name: string; periods: Record<string, { in: number; out: number }> }> = {};
    filteredTx.forEach(t => {
      const key = periodKey(t.createdAt, viewMode);
      if (!map[t.materialId]) {
        map[t.materialId] = { id: t.materialId, name: t.materialName, periods: {} };
        periods.forEach(p => { map[t.materialId].periods[p] = { in: 0, out: 0 }; });
      }
      if (!map[t.materialId].periods[key]) map[t.materialId].periods[key] = { in: 0, out: 0 };
      if (t.type === "입고") map[t.materialId].periods[key].in  += t.qty;
      else                   map[t.materialId].periods[key].out += t.qty;
    });
    return Object.values(map).sort((a, b) => {
      const totalA = Object.values(a.periods).reduce((s, p) => s + p.in + p.out, 0);
      const totalB = Object.values(b.periods).reduce((s, p) => s + p.in + p.out, 0);
      return totalB - totalA;
    });
  }, [filteredTx, periods, viewMode]);

  // 차트 최대값
  const chartMax = Math.max(1, ...periods.map(p => Math.max(periodSummary[p]?.inQty ?? 0, periodSummary[p]?.outQty ?? 0)));

  function downloadExcel() {
    if (pivotData.length === 0) return;
    const rows = pivotData.map(m => {
      const row: Record<string, unknown> = { "자재코드": m.id, "자재명": m.name };
      periods.forEach(p => {
        row[`${periodDisplay(p, viewMode)}_입고`] = m.periods[p]?.in ?? 0;
        row[`${periodDisplay(p, viewMode)}_출고`] = m.periods[p]?.out ?? 0;
      });
      row["총입고"] = Object.values(m.periods).reduce((s, p) => s + p.in, 0);
      row["총출고"] = Object.values(m.periods).reduce((s, p) => s + p.out, 0);
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "입출고현황");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `입출고현황_${stamp}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {/* 검색 조건 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4 flex items-center gap-4 flex-wrap">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 shrink-0">조회 기준</span>
        {/* 조회 단위 */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
          {(["monthly", "quarterly", "yearly"] as ViewMode[]).map(m => (
            <button key={m} type="button" onClick={() => setViewMode(m)}
              className={`px-3.5 py-2 text-xs font-medium transition-colors ${
                viewMode === m ? "bg-blue-600 text-white" : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}>
              {m === "monthly" ? "월별" : m === "quarterly" ? "분기별" : "연도별"}
            </button>
          ))}
        </div>
        {/* 연도 선택 — 연도별 모드에서는 숨김 */}
        {viewMode !== "yearly" && (
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400">
            {YEARS.map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => setShowChart(v => !v)}
            className="px-3.5 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            {showChart ? "차트 숨기기" : "차트 표시"}
          </button>
          <button onClick={downloadExcel} disabled={pivotData.length === 0}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
            <span>📥</span> 엑셀 다운로드
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">총 입고 수량</p>
          <p className="text-2xl font-bold text-blue-600">{totalInQty.toLocaleString()}<span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">건</span></p>
          {totalInAmt > 0 && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{totalInAmt.toLocaleString()}원</p>}
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">총 출고 수량</p>
          <p className="text-2xl font-bold text-orange-500">{totalOutQty.toLocaleString()}<span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">건</span></p>
          {totalOutAmt > 0 && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{totalOutAmt.toLocaleString()}원</p>}
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">순 재고 증감</p>
          <p className={`text-2xl font-bold ${totalInQty - totalOutQty >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {totalInQty - totalOutQty >= 0 ? "+" : ""}{(totalInQty - totalOutQty).toLocaleString()}
            <span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">건</span>
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">처리 자재 종수</p>
          <p className="text-2xl font-bold text-slate-700 dark:text-slate-300">{pivotData.length.toLocaleString()}<span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">종</span></p>
        </div>
      </div>

      {/* 차트 */}
      {showChart && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">입고 vs 출고 수량 비교</h3>
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-400 inline-block" /> 입고</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-400 inline-block" /> 출고</span>
            </div>
          </div>

          {loading ? (
            <div className="h-40 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">데이터 로딩 중...</div>
          ) : filteredTx.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
              <p className="text-3xl mb-2">📊</p>
              <p className="text-sm">해당 기간의 데이터가 없습니다</p>
            </div>
          ) : (
            <div className="flex items-end gap-1 h-40 px-2">
              {periods.map(p => {
                const inH  = ((periodSummary[p]?.inQty  ?? 0) / chartMax) * 100;
                const outH = ((periodSummary[p]?.outQty ?? 0) / chartMax) * 100;
                return (
                  <div key={p} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                    <div className="w-full flex items-end gap-0.5 h-32">
                      <div className="flex-1 bg-blue-400 rounded-t transition-all"
                        style={{ height: `${Math.max(inH, 2)}%` }}
                        title={`입고: ${periodSummary[p]?.inQty ?? 0}건`}
                      />
                      <div className="flex-1 bg-orange-400 rounded-t transition-all"
                        style={{ height: `${Math.max(outH, 2)}%` }}
                        title={`출고: ${periodSummary[p]?.outQty ?? 0}건`}
                      />
                    </div>
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate w-full text-center">
                      {periodDisplay(p, viewMode)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 피벗 그리드 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">자재별 입출고 상세</h3>
          <span className="text-xs text-gray-400 dark:text-gray-500">{pivotData.length}종</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">데이터 로딩 중...</div>
        ) : pivotData.length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">
            <p className="text-3xl mb-2">📋</p>
            <p>해당 기간의 입출고 데이터가 없습니다</p>
            <p className="text-sm mt-1">입고 또는 출고를 등록하면 여기에 표시됩니다</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap sticky left-0 bg-gray-50 dark:bg-gray-700/50 z-10 min-w-[180px]">자재명</th>
                  <th className="px-3 py-3 text-left font-medium text-gray-400 dark:text-gray-500 whitespace-nowrap font-mono min-w-[120px]">코드</th>
                  {periods.map(p => (
                    <th key={p} className="px-3 py-3 text-center font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap min-w-[80px]">
                      {periodDisplay(p, viewMode)}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap bg-gray-100 dark:bg-gray-600/50 min-w-[80px] sticky right-0">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {pivotData.map(m => {
                  const rowTotal = Object.values(m.periods).reduce((s, p) => s + p.in + p.out, 0);
                  return (
                    <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap sticky left-0 bg-white dark:bg-gray-800">{m.name}</td>
                      <td className="px-3 py-3 font-mono text-gray-400 dark:text-gray-500 whitespace-nowrap">{m.id}</td>
                      {periods.map(p => {
                        const cell = m.periods[p];
                        const hasData = cell && (cell.in > 0 || cell.out > 0);
                        return (
                          <td key={p} className="px-3 py-3 text-center">
                            {hasData ? (
                              <div className="space-y-0.5">
                                {cell.in  > 0 && <div className="text-blue-600 font-medium">+{cell.in}</div>}
                                {cell.out > 0 && <div className="text-orange-500 font-medium">-{cell.out}</div>}
                              </div>
                            ) : (
                              <span className="text-gray-200 dark:text-gray-600">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center font-bold text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/30 sticky right-0">{rowTotal}</td>
                    </tr>
                  );
                })}
                {/* 합계 행 */}
                <tr className="bg-gray-100 dark:bg-gray-700/50 font-semibold border-t-2 border-gray-200 dark:border-gray-600">
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200 sticky left-0 bg-gray-100 dark:bg-gray-700/50">합계</td>
                  <td className="px-3 py-3" />
                  {periods.map(p => {
                    const total = pivotData.reduce((s, m) => s + (m.periods[p]?.in ?? 0) + (m.periods[p]?.out ?? 0), 0);
                    return (
                      <td key={p} className="px-3 py-3 text-center text-gray-700 dark:text-gray-300">
                        {total > 0 ? total : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-center text-gray-800 dark:text-gray-200 bg-gray-200 dark:bg-gray-600/50 sticky right-0">
                    {pivotData.reduce((s, m) => s + Object.values(m.periods).reduce((s2, p) => s2 + p.in + p.out, 0), 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
