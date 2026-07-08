"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { fmtNum } from "@/lib/format";

const MENU_HREF = "/accounting/incentive";

// 회사 × 지역 참조 매트릭스
const COMPANY_REGIONS: Record<string, readonly string[]> = {
  DS: ["화정", "일산", "파주", "기타"],
  TK: ["화정", "일산", "파주"],
};
const COMPANIES = Object.keys(COMPANY_REGIONS);

function regionsOf(company: string): readonly string[] {
  return COMPANY_REGIONS[company] ?? [];
}

const ALL = "__ALL__";

interface Row {
  id: string;
  month: string;
  issueDate: string;
  company: string;
  region: string;
  site: string;
  contract: string;
  quote: number;
  fixed: number;
  material: number;
  manager: string;
  remark: string;
}

// 엑셀 수식
//   Nego(40%)   = (견적가 − 확정가) × 0.4
//   순수자재비  = 자재비 − Nego
//   인센티브    = 순수자재비 × 0.02
function computeMetrics(r: Pick<Row, "quote" | "fixed" | "material">) {
  const nego = (r.quote - r.fixed) * 0.4;
  const pure = r.material - nego;
  const incentive = pure * 0.02;
  return { nego, pure, incentive };
}

function fmtDec(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstOfMonth(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  return `${y}-${String(mm).padStart(2, "0")}-01`;
}
function lastOfMonth(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm, 0).getDate();
  return `${y}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function fmtDate(d: string): string {
  return d ? d.replace(/-/g, ".") : "-";
}

export default function IncentiveClient() {
  const { user } = useAuth();
  const canCreate = !!user && (isAdmin(user) || hasMenuPermission(user, MENU_HREF, "create"));
  const [fromDate, setFromDate] = useState<string>(() => firstOfMonth(currentMonth()));
  const [toDate, setToDate]     = useState<string>(() => lastOfMonth(currentMonth()));
  const [rows, setRows] = useState<Row[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string>(ALL);
  const [regionFilter, setRegionFilter]   = useState<string>(ALL);
  const [siteQuery, setSiteQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const fetchRows = useCallback(async (from: string, to: string) => {
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    setLoading(true);
    const { data, error } = await supabase
      .from("incentive_records")
      .select("id, month, issue_date, company, region, site, contract, quote, fixed, material, manager, remark, sort_order")
      .gte("issue_date", lo)
      .lte("issue_date", hi)
      .order("issue_date", { ascending: true })
      .order("sort_order", { ascending: true });
    setLoading(false);
    if (error) {
      console.error("[incentive] load rows error", error);
      alert(`인센티브 데이터 로드 실패: ${error.message}`);
      setRows([]);
      return;
    }
    setRows((data ?? []).map(r => ({
      id: String(r.id),
      month: r.month ?? "",
      issueDate: r.issue_date ?? "",
      company: r.company ?? "",
      region: r.region ?? "",
      site: r.site ?? "",
      contract: r.contract ?? "",
      quote: Number(r.quote) || 0,
      fixed: Number(r.fixed) || 0,
      material: Number(r.material) || 0,
      manager: r.manager ?? "",
      remark: r.remark ?? "",
    })));
  }, []);

  useEffect(() => { fetchRows(fromDate, toDate); }, [fromDate, toDate, fetchRows]);

  // 탭이 서브 라우트(전표입력)에서 리스트로 돌아왔을 때 자동 재조회
  useReloadOnActivate(useCallback(() => { fetchRows(fromDate, toDate); }, [fetchRows, fromDate, toDate]));

  // 지역 옵션: 회사 매트릭스에 있는 모든 지역의 합집합
  const REGION_OPTIONS: string[] = useMemo(() => {
    const set = new Set<string>();
    for (const c of COMPANIES) for (const r of regionsOf(c)) set.add(r);
    return Array.from(set);
  }, []);

  // 필터 적용된 표시 행
  const visibleRows = useMemo(() => {
    const q = siteQuery.trim().toLowerCase();
    return rows.filter(row => {
      if (companyFilter !== ALL && row.company !== companyFilter) return false;
      if (regionFilter  !== ALL && row.region  !== regionFilter)  return false;
      if (q && !row.site.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, companyFilter, regionFilter, siteQuery]);

  // 총계
  const total = useMemo(() => {
    return visibleRows.reduce((acc, r) => {
      const { nego, pure, incentive } = computeMetrics(r);
      acc.d += r.quote; acc.e += r.fixed; acc.f += r.material;
      acc.g += nego;    acc.h += pure;    acc.i += incentive;
      return acc;
    }, { d: 0, e: 0, f: 0, g: 0, h: 0, i: 0 });
  }, [visibleRows]);

  const activeLabel = (() => {
    const parts: string[] = [];
    if (companyFilter !== ALL) parts.push(companyFilter);
    if (regionFilter  !== ALL) parts.push(regionFilter);
    return parts.length === 0 ? "전체" : parts.join(" · ");
  })();

  function exportToExcel() {
    if (visibleRows.length === 0) { alert("내보낼 데이터가 없습니다."); return; }
    const rows = visibleRows.map(r => {
      const { nego, pure, incentive } = computeMetrics(r);
      return {
        "발행일": r.issueDate,
        "회사": r.company,
        "지역": r.region,
        "현장명": r.site,
        "계약내역": r.contract,
        "견적가": r.quote,
        "확정가": r.fixed,
        "자재비": r.material,
        "Nego(40%)": Number(nego.toFixed(2)),
        "순수자재비": Number(pure.toFixed(2)),
        "인센티브": Number(incentive.toFixed(2)),
        "담당자": r.manager,
        "비고": r.remark,
      };
    });
    // 합계 행
    rows.push({
      "발행일": "",
      "회사": "",
      "지역": "",
      "현장명": "합계",
      "계약내역": "",
      "견적가": total.d,
      "확정가": total.e,
      "자재비": total.f,
      "Nego(40%)": Number(total.g.toFixed(2)),
      "순수자재비": Number(total.h.toFixed(2)),
      "인센티브": Number(total.i.toFixed(2)),
      "담당자": "",
      "비고": "",
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 26 }, { wch: 22 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 13 },
      { wch: 12 }, { wch: 10 }, { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "인센티브내역");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label = activeLabel === "전체" ? "" : `_${activeLabel.replace(/\s·\s/g, "-")}`;
    a.href = url;
    a.download = `인센티브내역${label}_${fromDate.replace(/-/g, "")}_${toDate.replace(/-/g, "")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-5 print:p-0 print:space-y-3">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">인센티브 관리</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            발행일 기준 조회 전용. 신규 등록은 [+ 전표입력] 버튼으로.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportToExcel}
            disabled={visibleRows.length === 0}
            className={`h-9 px-3 inline-flex items-center gap-1.5 rounded text-xs font-semibold text-white ${
              visibleRows.length === 0 ? "bg-emerald-300 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
            title={visibleRows.length === 0 ? "내보낼 데이터가 없습니다" : "현재 검색·필터 결과를 엑셀로 저장"}
          >
            <span aria-hidden>📥</span>
            엑셀 저장 ({visibleRows.length}건)
          </button>
        </div>
      </div>

      {/* 검색 필터 */}
      <div className="space-y-2 print:hidden">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 mr-1 w-10">구분</span>
          <select
            value={companyFilter}
            onChange={e => setCompanyFilter(e.target.value)}
            className="h-8 px-2 pr-7 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 min-w-[130px] focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value={ALL}>전체</option>
            {COMPANIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {companyFilter !== ALL && (
            <button
              type="button"
              onClick={() => setCompanyFilter(ALL)}
              className="text-xs text-gray-400 hover:text-red-500 px-1"
              title="구분 필터 해제"
            >×</button>
          )}

          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 ml-3 mr-1 w-10">지역</span>
          <select
            value={regionFilter}
            onChange={e => setRegionFilter(e.target.value)}
            className="h-8 px-2 pr-7 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 min-w-[130px] focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value={ALL}>전체</option>
            {REGION_OPTIONS.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {regionFilter !== ALL && (
            <button
              type="button"
              onClick={() => setRegionFilter(ALL)}
              className="text-xs text-gray-400 hover:text-red-500 px-1"
              title="지역 필터 해제"
            >×</button>
          )}

          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 ml-3 mr-1 w-10">기간</span>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value || today())}
            className="h-8 px-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">~</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value || today())}
            className="h-8 px-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />

          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 ml-3 mr-1 w-10">현장</span>
          <div className="relative">
            <input
              type="search"
              value={siteQuery}
              onChange={e => setSiteQuery(e.target.value)}
              placeholder="현장명 검색"
              className="h-8 pl-7 pr-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 w-[240px] focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔍</span>
            {siteQuery && (
              <button
                type="button"
                onClick={() => setSiteQuery("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-xs w-5 h-5 flex items-center justify-center"
                title="지우기"
              >×</button>
            )}
          </div>

          {canCreate && (
            <Link
              href="/accounting/incentive/new"
              className="h-8 px-3 ml-2 inline-flex items-center rounded text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700"
              title="전표 입력 화면으로 이동"
            >
              + 전표입력
            </Link>
          )}
        </div>
      </div>

      {/* 인쇄용 헤더 */}
      <div className="hidden print:block text-center border-b border-gray-800 pb-2 mb-2">
        <h1 className="text-lg font-bold">
          {fromDate === toDate ? fmtDate(fromDate) : `${fmtDate(fromDate)} ~ ${fmtDate(toDate)}`} 인센티브 내역 · {activeLabel}
        </h1>
      </div>

      {/* 통합 표 (조회 전용) */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden print:border print:rounded-none">
        <header className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-gray-600 dark:text-gray-300">
            표시: <span className="font-semibold text-gray-900 dark:text-gray-100">{activeLabel}</span>
            {siteQuery.trim() && (
              <span className="ml-1 text-gray-500 dark:text-gray-400">· 현장 &ldquo;<span className="font-semibold text-gray-800 dark:text-gray-100">{siteQuery.trim()}</span>&rdquo;</span>
            )}
            <span className="text-xs text-gray-400 ml-2">({visibleRows.length}건 / 전체 {rows.length}건)</span>
            {loading && <span className="text-xs text-blue-500 ml-2">불러오는 중...</span>}
          </div>
        </header>

        <div className="overflow-auto max-h-[calc(100vh-280px)] print:max-h-none print:overflow-visible">
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-2 py-2 text-center font-semibold w-[100px]">발행일</th>
                <th className="px-2 py-2 text-center font-semibold w-[60px]">회사</th>
                <th className="px-2 py-2 text-center font-semibold w-[70px]">지역</th>
                <th className="px-2 py-2 text-center font-semibold w-[220px]">현 장 명</th>
                <th className="px-2 py-2 text-center font-semibold w-[200px]">계약 내역</th>
                <th className="px-2 py-2 text-center font-semibold w-[110px]">견적가</th>
                <th className="px-2 py-2 text-center font-semibold w-[110px]">확정가</th>
                <th className="px-2 py-2 text-center font-semibold w-[110px]">자재비</th>
                <th className="px-2 py-2 text-center font-semibold w-[100px] bg-amber-50 dark:bg-amber-900/20">Nego(40%)</th>
                <th className="px-2 py-2 text-center font-semibold w-[110px] bg-amber-50 dark:bg-amber-900/20">순수자재비</th>
                <th className="px-2 py-2 text-center font-semibold w-[100px] bg-emerald-50 dark:bg-emerald-900/20">인센티브</th>
                <th className="px-2 py-2 text-center font-semibold w-[90px]">담당자</th>
                <th className="px-2 py-2 text-center font-semibold w-[130px]">비고</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-8 text-center text-gray-400 dark:text-gray-500">
                    {canCreate ? "데이터가 없습니다. 상단 [+ 전표입력] 버튼으로 입력하세요." : "데이터가 없습니다."}
                  </td>
                </tr>
              )}
              {visibleRows.map((r) => {
                const { nego, pure, incentive } = computeMetrics(r);
                return (
                  <tr key={r.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-2 py-1.5 text-center text-gray-700 dark:text-gray-200 whitespace-nowrap">{fmtDate(r.issueDate)}</td>
                    <td className="px-2 py-1.5 text-center text-gray-700 dark:text-gray-200">{r.company || "-"}</td>
                    <td className="px-2 py-1.5 text-center text-gray-700 dark:text-gray-200">{r.region || "-"}</td>
                    <td className="px-2 py-1.5 text-left text-gray-800 dark:text-gray-100">{r.site || "-"}</td>
                    <td className="px-2 py-1.5 text-left text-gray-700 dark:text-gray-200">{r.contract || "-"}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-200">{fmtNum(r.quote)}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-200">{fmtNum(r.fixed)}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-200">{fmtNum(r.material)}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-200 bg-amber-50/60 dark:bg-amber-900/10">{fmtDec(nego)}</td>
                    <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-200 bg-amber-50/60 dark:bg-amber-900/10">{fmtDec(pure)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-900/10">{fmtDec(incentive)}</td>
                    <td className="px-2 py-1.5 text-center text-gray-700 dark:text-gray-200">{r.manager || "-"}</td>
                    <td className="px-2 py-1.5 text-left text-gray-600 dark:text-gray-300">{r.remark || ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10">
              <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 font-semibold text-gray-800 dark:text-gray-100 shadow-[0_-1px_0_rgba(0,0,0,0.05)]">
                <td colSpan={5} className="px-2 py-2 text-right">합계</td>
                <td className="px-2 py-2 text-right">{fmtNum(total.d)}</td>
                <td className="px-2 py-2 text-right">{fmtNum(total.e)}</td>
                <td className="px-2 py-2 text-right">{fmtNum(total.f)}</td>
                <td className="px-2 py-2 text-right bg-amber-50 dark:bg-amber-900/20">{fmtDec(total.g)}</td>
                <td className="px-2 py-2 text-right bg-amber-50 dark:bg-amber-900/20">{fmtDec(total.h)}</td>
                <td className="px-2 py-2 text-right bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">{fmtDec(total.i)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <p className="text-xs text-gray-600 dark:text-gray-400 print:mt-4">
        ※ 인센티브 기준은 당월 발행된 매출 계산서나 입금표를 기준으로 함.
      </p>
    </div>
  );
}
