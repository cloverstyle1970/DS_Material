"use client";

import { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { api } from "@/lib/api-client";
import { fmtNum } from "@/lib/format";
import { useAuth, isViewOnly, isNonManager } from "@/context/AuthContext";

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

function fmtDate(iso: string) {
  return iso.substring(0, 10);
}

export default function SiteStatsClient() {
  const { user } = useAuth();
  // 금액(입고·출고·수익금)은 비관리자(보수일반/공사일반)에게만 숨김. 그 외 관리자급은 노출.
  const showFin = user ? !isNonManager(user) : false;
  // 엑셀에는 전체 금액이 담기므로 다운로드도 관리자 전용으로 제한.
  const canDownload = showFin;
  const [selectedSite, setSelectedSite] = useState<string>("");
  // 좌측 '현장별 투입 현황'에서 현장명 클릭 시, 우측 '자재별 투입 현황'만 해당 현장으로 좁히는 필터.
  // (좌측 목록은 그대로 유지 — 다른 현장을 이어서 클릭할 수 있도록)
  const [detailSite, setDetailSite] = useState<string>("");
  // 모바일(<768px)에서는 우측 패널 대신 팝업(모달)로 자재별 내역을 표시.
  const [isMobile, setIsMobile] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  function handleSiteClick(site: string) {
    if (isMobile) {
      // 모바일: 해당 현장으로 좁히고 팝업 표시
      setDetailSite(site);
      setMobileDetailOpen(true);
    } else {
      // 데스크탑: 우측 패널 토글
      setDetailSite(prev => (prev === site ? "" : site));
    }
  }

  function closeMobileDetail() {
    setMobileDetailOpen(false);
    setDetailSite("");
  }
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().substring(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().substring(0, 10));

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<Transaction[]>("/api/transactions")
      .then(data => setTransactions(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
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
    const siteQuery = selectedSite.trim().toLowerCase();
    return transactions.filter(t => {
      const d = t.createdAt.substring(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      if (siteQuery && !(t.siteName ?? "").toLowerCase().includes(siteQuery)) return false;
      return true;
    });
  }, [transactions, dateFrom, dateTo, selectedSite]);

  // 현장별 집계
  const siteStats = useMemo(() => {
    const map: Record<string, {
      site: string;
      inQty: number;
      inAmt: number;
      outQty: number;
      outAmt: number;
      materials: Set<string>;
      lastDate: string;
    }> = {};
    filtered.forEach(t => {
      const site = t.siteName ?? "미지정";
      if (!map[site]) map[site] = { site, inQty: 0, inAmt: 0, outQty: 0, outAmt: 0, materials: new Set(), lastDate: "" };
      const price = t.unitPrice ?? 0;
      const amt = t.qty * price;
      if (t.type === "입고") {
        map[site].inQty += t.qty;
        map[site].inAmt += amt;
      } else {
        map[site].outQty += t.qty;
        map[site].outAmt += amt;
      }
      map[site].materials.add(t.materialId);
      if (t.createdAt > map[site].lastDate) map[site].lastDate = t.createdAt;
    });
    return Object.values(map).sort((a, b) => b.outAmt - a.outAmt);
  }, [filtered]);

  // 자재별 집계 (좌측에서 클릭한 현장(detailSite)이 있으면 그 현장만, 없으면 검색 결과 전체)
  const materialStats = useMemo(() => {
    const source = detailSite
      ? filtered.filter(t => (t.siteName ?? "미지정") === detailSite)
      : filtered;
    const map: Record<string, {
      id: string;
      name: string;
      inQty: number;
      inAmt: number;
      outQty: number;
      outAmt: number;
      lastDate: string;
    }> = {};
    source.forEach(t => {
      if (!map[t.materialId]) map[t.materialId] = { id: t.materialId, name: t.materialName, inQty: 0, inAmt: 0, outQty: 0, outAmt: 0, lastDate: "" };
      const price = t.unitPrice ?? 0;
      const amt = t.qty * price;
      if (t.type === "입고") {
        map[t.materialId].inQty += t.qty;
        map[t.materialId].inAmt += amt;
      } else {
        map[t.materialId].outQty += t.qty;
        map[t.materialId].outAmt += amt;
      }
      if (t.createdAt > map[t.materialId].lastDate) map[t.materialId].lastDate = t.createdAt;
    });
    return Object.values(map).sort((a, b) => b.outAmt - a.outAmt); // Note: sorting by outbound amount
  }, [filtered, detailSite]);

  const totalIn  = filtered.filter(t => t.type === "입고").reduce((s, t) => s + t.qty, 0);
  const totalOut = filtered.filter(t => t.type === "출고").reduce((s, t) => s + t.qty, 0);
  const totalInAmt  = filtered.filter(t => t.type === "입고").reduce((s, t) => s + t.qty * (t.unitPrice ?? 0), 0);
  const totalOutAmt = filtered.filter(t => t.type === "출고").reduce((s, t) => s + t.qty * (t.unitPrice ?? 0), 0);

  const ledgerTransactions = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return arr;
  }, [filtered]);

  function downloadExcel() {
    if (materialStats.length === 0) return;
    const rows = materialStats.map(m => ({
      자재코드: m.id,
      자재명: m.name,
      "차변(입고수량)": m.inQty,
      "차변(입고금액)": m.inAmt,
      "대변(출고수량)": m.outQty,
      "대변(출고금액)": m.outAmt,
      "수익금(수량)": m.outQty - m.inQty,
      "수익금(금액)": m.outAmt - m.inAmt,
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

  // 자재별 투입 현황 본문 (우측 패널 + 모바일 팝업에서 공용)
  function renderMaterialBody(scrollClass = "max-h-80") {
    if (loading) {
      return <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">데이터 로딩 중...</div>;
    }
    if (materialStats.length === 0) {
      return (
        <div className="py-12 text-center text-gray-400 dark:text-gray-500">
          <p className="text-3xl mb-2">📦</p>
          <p className="text-sm">해당 기간/현장의 데이터가 없습니다</p>
        </div>
      );
    }
    return (
      <div className={`${scrollClass} overflow-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">자재명</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">코드</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap" colSpan={2}>차변 (입고)</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap" colSpan={2}>대변 (출고)</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap" colSpan={2}>수익금</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">최종처리일</th>
            </tr>
            <tr className="bg-gray-100/30 dark:bg-gray-800/20 text-[10px] text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
              <th></th>
              <th></th>
              <th className="px-2 py-1 font-normal border-r border-gray-200/20 dark:border-gray-700/20">수량</th>
              <th className="px-2 py-1 font-normal pr-4">금액</th>
              <th className="px-2 py-1 font-normal border-r border-gray-200/20 dark:border-gray-700/20">수량</th>
              <th className="px-2 py-1 font-normal pr-4">금액</th>
              <th className="px-2 py-1 font-normal border-r border-gray-200/20 dark:border-gray-700/20">수량</th>
              <th className="px-2 py-1 font-normal pr-4">금액</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {materialStats.map(m => {
              const balQty = m.outQty - m.inQty;
              const balAmt = m.outAmt - m.inAmt;
              return (
                <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 text-center font-medium text-gray-800 dark:text-gray-200 max-w-[150px] truncate">{m.name}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{m.id}</td>
                  <td className="px-2 py-3 text-center text-blue-600 font-medium tabular-nums border-r border-gray-200/20 dark:border-gray-700/20">{m.inQty > 0 ? fmtNum(m.inQty) : "—"}</td>
                  <td className="px-2 py-3 text-right text-blue-600 font-medium tabular-nums pr-4">{showFin ? (m.inAmt > 0 ? `₩${fmtNum(m.inAmt)}` : "—") : ""}</td>
                  <td className="px-2 py-3 text-center text-orange-500 font-medium tabular-nums border-r border-gray-200/20 dark:border-gray-700/20">{m.outQty > 0 ? fmtNum(m.outQty) : "—"}</td>
                  <td className="px-2 py-3 text-right text-orange-500 font-medium tabular-nums pr-4">{showFin ? (m.outAmt > 0 ? `₩${fmtNum(m.outAmt)}` : "—") : ""}</td>
                  <td className={`px-2 py-3 text-center font-bold tabular-nums border-r border-gray-200/20 dark:border-gray-700/20 ${balQty >= 0 ? "text-slate-700 dark:text-slate-300" : "text-red-500"}`}>{fmtNum(balQty)}</td>
                  <td className={`px-2 py-3 text-right font-bold tabular-nums pr-4 ${balAmt >= 0 ? "text-slate-700 dark:text-slate-300" : "text-red-500"}`}>{showFin ? `₩${fmtNum(balAmt)}` : ""}</td>
                  <td className="px-4 py-3 text-center text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(m.lastDate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
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
          {/* 현장 필터 (입력 + 자동완성) */}
          <div className="relative flex items-center">
            <input type="text" lang="ko" list="site-stats-options"
              value={selectedSite} onChange={e => setSelectedSite(e.target.value)}
              placeholder="전체 현장 (입력하여 검색)"
              className="w-56 px-3 py-2 pr-7 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            {selectedSite && (
              <button type="button" onClick={() => setSelectedSite("")}
                aria-label="현장 필터 초기화"
                className="absolute right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">×</button>
            )}
            <datalist id="site-stats-options">
              {sites.map(s => <option key={s.id} value={s.name} />)}
            </datalist>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {canDownload && (
              <button onClick={downloadExcel} disabled={materialStats.length === 0}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                <span>📥</span> 엑셀 다운로드
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{showFin ? "조회 입고 금액 (차변)" : "조회 입고 수량 (차변)"}</p>
          <p className="text-xl font-bold text-blue-600">{showFin ? `₩${fmtNum(totalInAmt)}` : `${fmtNum(totalIn)} EA`}</p>
          {showFin && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">수량: {fmtNum(totalIn)} EA</p>}
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{showFin ? "조회 출고 금액 (대변)" : "조회 출고 수량 (대변)"}</p>
          <p className="text-xl font-bold text-orange-500">{showFin ? `₩${fmtNum(totalOutAmt)}` : `${fmtNum(totalOut)} EA`}</p>
          {showFin && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">수량: {fmtNum(totalOut)} EA</p>}
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">관련 현장 수</p>
          <p className="text-xl font-bold text-slate-700 dark:text-slate-300">{fmtNum(siteStats.length)}<span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">곳</span></p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">투입 자재 종수</p>
          <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{fmtNum(materialStats.length)}<span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">종</span></p>
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
            <div className="overflow-auto max-h-[calc(100vh-250px)]">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">현장명</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap" colSpan={2}>차변 (입고)</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap" colSpan={2}>대변 (출고)</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap" colSpan={2}>수익금</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">자재종수</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">최종처리일</th>
                </tr>
                <tr className="bg-gray-100/30 dark:bg-gray-800/20 text-[10px] text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                  <th></th>
                  <th className="px-2 py-1 font-normal border-r border-gray-200/20 dark:border-gray-700/20">수량</th>
                  <th className="px-2 py-1 font-normal pr-4">금액</th>
                  <th className="px-2 py-1 font-normal border-r border-gray-200/20 dark:border-gray-700/20">수량</th>
                  <th className="px-2 py-1 font-normal pr-4">금액</th>
                  <th className="px-2 py-1 font-normal border-r border-gray-200/20 dark:border-gray-700/20">수량</th>
                  <th className="px-2 py-1 font-normal pr-4">금액</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {siteStats.map(s => {
                  const balQty = s.outQty - s.inQty;
                  const balAmt = s.outAmt - s.inAmt;
                  const isSelected = !isMobile && detailSite === s.site;
                  return (
                    <tr key={s.site}
                      onClick={() => handleSiteClick(s.site)}
                      title={isMobile ? "클릭하여 자재별 내역 팝업 보기" : "클릭하여 우측 자재별 현황에 표시 (다시 클릭 시 해제)"}
                      className={`cursor-pointer transition-colors ${isSelected ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-700/30"}`}>
                      <td className={`px-4 py-3 text-center font-medium max-w-[160px] truncate ${isSelected ? "text-blue-600 dark:text-blue-400 underline underline-offset-2" : "text-gray-800 dark:text-gray-200"}`}>{s.site}</td>
                      <td className="px-2 py-3 text-center text-blue-600 font-medium tabular-nums border-r border-gray-200/20 dark:border-gray-700/20">{fmtNum(s.inQty)}</td>
                      <td className="px-2 py-3 text-right text-blue-600 font-medium tabular-nums pr-4">{showFin ? `₩${fmtNum(s.inAmt)}` : ""}</td>
                      <td className="px-2 py-3 text-center text-orange-500 font-medium tabular-nums border-r border-gray-200/20 dark:border-gray-700/20">{fmtNum(s.outQty)}</td>
                      <td className="px-2 py-3 text-right text-orange-500 font-medium tabular-nums pr-4">{showFin ? `₩${fmtNum(s.outAmt)}` : ""}</td>
                      <td className={`px-2 py-3 text-center font-bold tabular-nums border-r border-gray-200/20 dark:border-gray-700/20 ${balQty >= 0 ? "text-slate-700 dark:text-slate-300" : "text-red-500"}`}>{fmtNum(balQty)}</td>
                      <td className={`px-2 py-3 text-right font-bold tabular-nums pr-4 ${balAmt >= 0 ? "text-slate-700 dark:text-slate-300" : "text-red-500"}`}>{showFin ? `₩${fmtNum(balAmt)}` : ""}</td>
                      <td className="px-4 py-3 text-center text-gray-500 dark:text-gray-400 tabular-nums">{fmtNum(s.materials.size)}</td>
                      <td className="px-4 py-3 text-center text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(s.lastDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {/* 자재별 투입 현황 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
              자재별 투입 현황
              {detailSite ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 text-xs font-medium">
                  {detailSite}
                  <button type="button" onClick={() => setDetailSite("")}
                    aria-label="현장 선택 해제"
                    className="hover:text-blue-800 dark:hover:text-blue-100 leading-none">×</button>
                </span>
              ) : selectedSite ? (
                <span className="ml-1 text-xs text-gray-400 dark:text-gray-500 font-normal">({selectedSite})</span>
              ) : null}
            </h3>
          </div>
          {renderMaterialBody()}
        </div>
      </div>

      {/* 이력 테이블 */}
      {filtered.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">입출고 이력 원장</h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">{filtered.length}건</span>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">일시</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">자재명</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap" colSpan={2}>차변 (입고)</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap" colSpan={2}>대변 (출고)</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">현장</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">처리자</th>
                </tr>
                <tr className="bg-gray-100/30 dark:bg-gray-800/20 text-[10px] text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                  <th></th>
                  <th></th>
                  <th className="px-2 py-1 font-normal border-r border-gray-200/20 dark:border-gray-700/20">수량</th>
                  <th className="px-2 py-1 font-normal pr-4">금액</th>
                  <th className="px-2 py-1 font-normal border-r border-gray-200/20 dark:border-gray-700/20">수량</th>
                  <th className="px-2 py-1 font-normal pr-4">금액</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {ledgerTransactions.slice(0, 100).map(t => {
                  const price = t.unitPrice ?? 0;
                  const amt = t.qty * price;
                  const isIn = t.type === "입고";
                  return (
                    <tr key={`${t.type}-${t.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-3 text-center text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                      <td className="px-4 py-3 text-center font-medium text-gray-800 dark:text-gray-200 max-w-[180px] truncate">{t.materialName}</td>
                      
                      {/* 차변 (입고) */}
                      <td className="px-2 py-3 text-center text-blue-600 font-medium tabular-nums border-r border-gray-200/20 dark:border-gray-700/20">
                        {isIn ? fmtNum(t.qty) : "—"}
                      </td>
                      <td className="px-2 py-3 text-right text-blue-600 font-medium tabular-nums pr-4">
                        {showFin ? (isIn ? `₩${fmtNum(amt)}` : "—") : ""}
                      </td>

                      {/* 대변 (출고) */}
                      <td className="px-2 py-3 text-center text-orange-500 font-medium tabular-nums border-r border-gray-200/20 dark:border-gray-700/20">
                        {!isIn ? fmtNum(t.qty) : "—"}
                      </td>
                      <td className="px-2 py-3 text-right text-orange-500 font-medium tabular-nums pr-4">
                        {showFin ? (!isIn ? `₩${fmtNum(amt)}` : "—") : ""}
                      </td>
                      
                      <td className="px-4 py-3 text-center text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{t.siteName ?? "—"}</td>
                      <td className="px-4 py-3 text-center text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{t.userName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 모바일 전용: 현장명 클릭 시 자재별 내역 팝업 */}
      {isMobile && mobileDetailOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={closeMobileDetail}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-2xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">자재별 투입 현황</h3>
                <p className="text-xs text-blue-600 dark:text-blue-300 font-medium truncate">{detailSite}</p>
              </div>
              <button type="button" onClick={closeMobileDetail}
                aria-label="닫기"
                className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none ml-3">×</button>
            </div>
            <div className="flex-1 overflow-auto">
              {renderMaterialBody("max-h-none")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
