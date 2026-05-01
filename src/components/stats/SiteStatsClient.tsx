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

interface SiteOption { id: number; name: string }

interface Props {
  sites: SiteOption[];
}

function fmtDate(iso: string) {
  return iso.substring(0, 10);
}

export default function SiteStatsClient({ sites }: Props) {
  const [selectedSite, setSelectedSite] = useState<string>("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().substring(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().substring(0, 10));

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<Transaction[]>("/api/transactions")
      .then(data => setTransactions(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function setThisMonth() {
    const now = new Date();
    setDateFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
    setDateTo(now.toISOString().substring(0, 10));
  }
  function setThisQuarter() {
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), q * 3, 1);
    setDateFrom(from.toISOString().substring(0, 10));
    setDateTo(now.toISOString().substring(0, 10));
  }
  function setThisYear() {
    const y = new Date().getFullYear();
    setDateFrom(`${y}-01-01`);
    setDateTo(`${y}-12-31`);
  }

  const filtered = useMemo(() => {
    return transactions.filter(t => {
      const d = t.createdAt.substring(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      if (selectedSite && t.siteName !== selectedSite) return false;
      return true;
    });
  }, [transactions, dateFrom, dateTo, selectedSite]);

  // 현장별 집계
  const siteStats = useMemo(() => {
    const map: Record<string, { site: string; inQty: number; outQty: number; materials: Set<string>; lastDate: string }> = {};
    filtered.forEach(t => {
      const site = t.siteName ?? "미지정";
      if (!map[site]) map[site] = { site, inQty: 0, outQty: 0, materials: new Set(), lastDate: "" };
      if (t.type === "입고") map[site].inQty  += t.qty;
      else                   map[site].outQty += t.qty;
      map[site].materials.add(t.materialId);
      if (t.createdAt > map[site].lastDate) map[site].lastDate = t.createdAt;
    });
    return Object.values(map).sort((a, b) => b.outQty - a.outQty);
  }, [filtered]);

  // 자재별 집계 (선택 현장 또는 전체)
  const materialStats = useMemo(() => {
    const map: Record<string, { id: string; name: string; inQty: number; outQty: number; lastDate: string }> = {};
    filtered.forEach(t => {
      if (!map[t.materialId]) map[t.materialId] = { id: t.materialId, name: t.materialName, inQty: 0, outQty: 0, lastDate: "" };
      if (t.type === "입고") map[t.materialId].inQty  += t.qty;
      else                   map[t.materialId].outQty += t.qty;
      if (t.createdAt > map[t.materialId].lastDate) map[t.materialId].lastDate = t.createdAt;
    });
    return Object.values(map).sort((a, b) => b.outQty - a.outQty);
  }, [filtered]);

  const totalIn  = filtered.filter(t => t.type === "입고").reduce((s, t) => s + t.qty, 0);
  const totalOut = filtered.filter(t => t.type === "출고").reduce((s, t) => s + t.qty, 0);

  function downloadExcel() {
    if (materialStats.length === 0) return;
    const rows = materialStats.map(m => ({
      자재코드: m.id, 자재명: m.name,
      입고수량: m.inQty, 출고수량: m.outQty,
      최종처리일: fmtDate(m.lastDate),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "현장투입현황");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `현장투입현황_${stamp}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {/* 검색 조건 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 shrink-0">조회 조건</span>
          {/* 기간 단축 버튼 */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
            {[
              { label: "당월", fn: setThisMonth },
              { label: "당분기", fn: setThisQuarter },
              { label: "당년", fn: setThisYear },
            ].map(({ label, fn }) => (
              <button key={label} type="button" onClick={fn}
                className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors border-r border-gray-200 dark:border-gray-600 last:border-0">
                {label}
              </button>
            ))}
          </div>
          {/* 기간 직접 입력 */}
          <div className="flex items-center gap-1.5">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <span className="text-gray-300 dark:text-gray-600 text-xs">~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          {/* 현장 필터 */}
          <select value={selectedSite} onChange={e => setSelectedSite(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">전체 현장</option>
            {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={downloadExcel} disabled={materialStats.length === 0}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
              <span>📥</span> 엑셀 다운로드
            </button>
          </div>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">조회 입고 수량</p>
          <p className="text-2xl font-bold text-blue-600">{totalIn.toLocaleString()}<span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">건</span></p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">조회 출고 수량</p>
          <p className="text-2xl font-bold text-orange-500">{totalOut.toLocaleString()}<span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">건</span></p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">관련 현장 수</p>
          <p className="text-2xl font-bold text-slate-700 dark:text-slate-300">{siteStats.length}<span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">곳</span></p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">투입 자재 종수</p>
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{materialStats.length}<span className="text-sm font-normal text-gray-400 dark:text-gray-500 ml-1">종</span></p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* 현장별 투입 현황 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">현장별 투입 현황</h3>
          </div>
          {loading ? (
            <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">데이터 로딩 중...</div>
          ) : siteStats.length === 0 ? (
            <div className="py-12 text-center text-gray-400 dark:text-gray-500">
              <p className="text-3xl mb-2">📍</p>
              <p className="text-sm">해당 기간의 데이터가 없습니다</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  {["현장명", "입고", "출고", "자재종수", "최종처리일"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {siteStats.map(s => (
                  <tr key={s.site} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 max-w-[160px] truncate">{s.site}</td>
                    <td className="px-4 py-3 text-blue-600 font-medium tabular-nums">+{s.inQty}</td>
                    <td className="px-4 py-3 text-orange-500 font-medium tabular-nums">-{s.outQty}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 tabular-nums">{s.materials.size}</td>
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(s.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 자재별 투입 현황 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              자재별 투입 현황
              {selectedSite && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500 font-normal">({selectedSite})</span>}
            </h3>
          </div>
          {loading ? (
            <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">데이터 로딩 중...</div>
          ) : materialStats.length === 0 ? (
            <div className="py-12 text-center text-gray-400 dark:text-gray-500">
              <p className="text-3xl mb-2">📦</p>
              <p className="text-sm">해당 기간/현장의 데이터가 없습니다</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 sticky top-0">
                  <tr>
                    {["자재명", "코드", "입고", "출고", "최종처리일"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {materialStats.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 max-w-[150px] truncate">{m.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{m.id}</td>
                      <td className="px-4 py-3 text-blue-600 tabular-nums">{m.inQty > 0 ? `+${m.inQty}` : "—"}</td>
                      <td className="px-4 py-3 text-orange-500 tabular-nums">{m.outQty > 0 ? `-${m.outQty}` : "—"}</td>
                      <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(m.lastDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 이력 테이블 */}
      {filtered.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">입출고 이력</h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">{filtered.length}건</span>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 sticky top-0">
                <tr>
                  {["일시", "구분", "자재명", "수량", "현장", "처리자"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {filtered.slice(0, 100).map(t => (
                  <tr key={`${t.type}-${t.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        t.type === "입고" ? "bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400" : "bg-orange-50 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400"
                      }`}>{t.type}</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 max-w-[180px] truncate">{t.materialName}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={t.type === "입고" ? "text-blue-600" : "text-orange-500"}>
                        {t.type === "입고" ? "+" : "-"}{t.qty}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{t.siteName ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{t.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
