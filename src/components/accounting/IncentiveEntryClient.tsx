"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fmtNum, parseNum } from "@/lib/format";

// 회사 × 지역 참조 매트릭스
const COMPANY_REGIONS: Record<string, readonly string[]> = {
  DS: ["화정", "일산", "파주", "기타"],
  TK: ["화정", "일산", "파주"],
};
const COMPANIES = Object.keys(COMPANY_REGIONS);
function regionsOf(company: string): readonly string[] {
  return COMPANY_REGIONS[company] ?? [];
}

interface SiteOption { id: number; name: string }

interface Line {
  id: string;
  site: string;
  contract: string;
  quote: number;
  fixed: number;
  material: number;
  remark: string;
  existingId?: string;  // 서버 uuid (수정 모드에서 UPDATE 대상)
}

interface Header {
  issueDate: string;
  company: string;
  region: string;
}

// 수정 모드 검색 결과 1건
interface SearchHit {
  id: string;
  issueDate: string;
  company: string;
  region: string;
  site: string;
  contract: string;
  quote: number;
  fixed: number;
  material: number;
  remark: string;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

function newLine(): Line {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, site: "", contract: "", quote: 0, fixed: 0, material: 0, remark: "" };
}

function computeMetrics(l: Pick<Line, "quote" | "fixed" | "material">) {
  const nego = (l.quote - l.fixed) * 0.4;
  const pure = l.material - nego;
  const incentive = pure * 0.02;
  return { nego, pure, incentive };
}

function fmtDec(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtDate(d: string): string { return d ? d.replace(/-/g, ".") : "-"; }

export default function IncentiveEntryClient() {
  const router = useRouter();

  const [editMode, setEditMode] = useState<boolean>(false);

  const [header, setHeader] = useState<Header>({
    issueDate: today(),
    company: "DS",
    region: "화정",
  });
  const [lines, setLines]   = useState<Line[]>(() => [newLine()]);
  const [sites, setSites]   = useState<SiteOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [continuous, setContinuous] = useState(true);
  const [lastBatch, setLastBatch] = useState<{ count: number; issueDate: string; label: string; incentiveTotal: number; mode: "insert" | "update" } | null>(null);

  // 수정 모드 검색 파라미터
  const [searchFrom, setSearchFrom] = useState<string>(() => firstOfMonth(currentMonth()));
  const [searchTo, setSearchTo]     = useState<string>(() => lastOfMonth(currentMonth()));
  const [searchSite, setSearchSite] = useState<string>("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);

  // 현장 목록 로드
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("managed_sites")
        .select("id, name:site_name")
        .order("site_name", { ascending: true });
      if (error) { console.error("[incentive-entry] load sites", error); return; }
      setSites((data ?? []).filter((s): s is SiteOption => !!s?.name));
    })();
  }, []);

  function updateHeader<K extends keyof Header>(key: K, value: Header[K]) {
    setHeader(prev => {
      const next = { ...prev, [key]: value };
      if (key === "company") {
        const allowed = regionsOf(value as string);
        if (allowed.length > 0 && !allowed.includes(next.region)) next.region = allowed[0];
      }
      return next;
    });
  }

  function updateLine(id: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }
  function addLine() { setLines(prev => [...prev, newLine()]); }
  function removeLine(id: string) {
    setLines(prev => prev.length <= 1 ? [newLine()] : prev.filter(l => l.id !== id));
  }

  const linesRef = useRef(lines);
  linesRef.current = lines;

  const validLines = useMemo(() => lines.filter(l => l.site.trim()), [lines]);

  const total = useMemo(() => {
    return validLines.reduce((acc, l) => {
      const { nego, pure, incentive } = computeMetrics(l);
      acc.d += l.quote; acc.e += l.fixed; acc.f += l.material;
      acc.g += nego;    acc.h += pure;    acc.i += incentive;
      return acc;
    }, { d: 0, e: 0, f: 0, g: 0, h: 0, i: 0 });
  }, [validLines]);

  // 수정 모드 검색
  const runSearch = useCallback(async () => {
    setSearchLoading(true);
    const lo = searchFrom <= searchTo ? searchFrom : searchTo;
    const hi = searchFrom <= searchTo ? searchTo : searchFrom;
    let query = supabase
      .from("incentive_records")
      .select("id, issue_date, company, region, site, contract, quote, fixed, material, remark")
      .gte("issue_date", lo)
      .lte("issue_date", hi)
      .order("issue_date", { ascending: true })
      .order("sort_order", { ascending: true })
      .limit(500);
    if (searchSite.trim()) query = query.ilike("site", `%${searchSite.trim()}%`);
    const { data, error } = await query;
    setSearchLoading(false);
    if (error) { alert(`검색 실패: ${error.message}`); return; }
    setSearchResults((data ?? []).map(r => ({
      id: String(r.id),
      issueDate: r.issue_date ?? "",
      company: r.company ?? "",
      region: r.region ?? "",
      site: r.site ?? "",
      contract: r.contract ?? "",
      quote: Number(r.quote) || 0,
      fixed: Number(r.fixed) || 0,
      material: Number(r.material) || 0,
      remark: r.remark ?? "",
    })));
  }, [searchFrom, searchTo, searchSite]);

  // 수정 모드 진입 시 자동 1회 검색
  useEffect(() => { if (editMode) runSearch(); }, [editMode, runSearch]);

  function pickForEdit(hit: SearchHit) {
    setHeader({ issueDate: hit.issueDate, company: hit.company, region: hit.region });
    const line: Line = {
      id: hit.id,
      existingId: hit.id,
      site: hit.site,
      contract: hit.contract,
      quote: hit.quote,
      fixed: hit.fixed,
      material: hit.material,
      remark: hit.remark,
    };
    setLines([line]);
    setSelectedHitId(hit.id);
    setLastBatch(null);
  }

  async function deleteSelected() {
    if (!selectedHitId) return;
    if (!confirm("이 인센티브 전표 1건을 완전히 삭제합니다. 계속하시겠습니까?")) return;
    const { error } = await supabase.from("incentive_records").delete().eq("id", selectedHitId);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    setSearchResults(prev => prev.filter(r => r.id !== selectedHitId));
    setSelectedHitId(null);
    setLines([newLine()]);
    alert("삭제되었습니다.");
  }

  async function save() {
    if (!header.issueDate) { alert("발행일을 입력하세요."); return; }
    if (!header.company)   { alert("회사를 선택하세요."); return; }
    if (!header.region)    { alert("지역을 선택하세요."); return; }
    if (validLines.length === 0) { alert("현장명이 입력된 라인이 없습니다."); return; }

    setSaving(true);
    const month = header.issueDate.slice(0, 7);

    if (editMode) {
      // 수정 저장: 선택된 라인 1건을 UPDATE
      const target = lines.find(l => !!l.existingId && l.site.trim());
      if (!target) { setSaving(false); alert("수정할 대상이 없습니다."); return; }
      const { error: upErr } = await supabase
        .from("incentive_records")
        .update({
          month,
          issue_date: header.issueDate,
          company: header.company,
          region: header.region,
          site: target.site.trim(),
          contract: target.contract.trim(),
          quote: target.quote,
          fixed: target.fixed,
          material: target.material,
          remark: target.remark.trim(),
        })
        .eq("id", target.existingId!);
      if (upErr) { setSaving(false); alert(`수정 실패: ${upErr.message}`); return; }
      setSaving(false);
      const { incentive } = computeMetrics(target);
      setLastBatch({
        count: 1,
        issueDate: header.issueDate,
        label: `${header.company} · ${header.region}`,
        incentiveTotal: incentive,
        mode: "update",
      });
      await runSearch();
      return;
    }

    // 신규 저장: 여러 라인 배치 INSERT
    const { data: last } = await supabase
      .from("incentive_records")
      .select("sort_order")
      .eq("month", month)
      .eq("company", header.company)
      .eq("region", header.region)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const startOrder = (last?.sort_order ?? -1) + 1;

    const payload = validLines.map((l, idx) => ({
      month,
      issue_date: header.issueDate,
      company: header.company,
      region: header.region,
      site: l.site.trim(),
      contract: l.contract.trim(),
      quote: l.quote,
      fixed: l.fixed,
      material: l.material,
      manager: "",
      remark: l.remark.trim(),
      sort_order: startOrder + idx,
    }));
    const { error: insErr } = await supabase.from("incentive_records").insert(payload);
    if (insErr) { setSaving(false); alert(`저장 실패: ${insErr.message}`); return; }
    setSaving(false);
    setLastBatch({
      count: validLines.length,
      issueDate: header.issueDate,
      label: `${header.company} · ${header.region}`,
      incentiveTotal: total.i,
      mode: "insert",
    });
    if (continuous) setLines([newLine()]);
    else goToList();
  }

  function goToList() { router.push("/accounting/incentive"); }

  function resetForm() {
    if (validLines.length > 0 || lines[0]?.contract || lines[0]?.quote || lines[0]?.fixed || lines[0]?.material) {
      if (!confirm("입력한 내용을 모두 지우고 새 전표로 시작합니다. 계속하시겠습니까?")) return;
    }
    setHeader({ issueDate: today(), company: "DS", region: "화정" });
    setLines([newLine()]);
    setSelectedHitId(null);
    setLastBatch(null);
  }

  // 수정 모드 토글 시 폼 상태 정리
  function toggleEditMode(next: boolean) {
    setEditMode(next);
    setSelectedHitId(null);
    setLines([newLine()]);
    setLastBatch(null);
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* 페이지 최상단 헤더 */}
      <div className="flex items-center gap-2">
        <span className="text-2xl">💎</span>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">인센티브 전표 입력</h1>
        {editMode && (
          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">수정 모드</span>
        )}
      </div>

      {/* 저장 결과 배너 */}
      {lastBatch && (
        <div className="rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-900/20 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
          <div>
            ✅ {lastBatch.mode === "update" ? "수정 완료" : `${lastBatch.count}건 저장 완료`} — {lastBatch.label} · 발행일 {lastBatch.issueDate} · 인센티브 <span className="font-semibold">{fmtDec(lastBatch.incentiveTotal)}</span>
          </div>
          <button type="button" onClick={() => setLastBatch(null)} className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 text-xs">닫기</button>
        </div>
      )}

      {/* 전표 헤더 카드 */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <header className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
          <span className="text-[11px] font-bold tracking-widest text-blue-500 dark:text-blue-300 uppercase">전표 헤더</span>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={editMode}
              onChange={e => toggleEditMode(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="font-semibold">수정모드</span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">(기존 전표 검색 후 선택 수정)</span>
          </label>
        </header>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="발행일 *">
            <input
              type="date"
              value={header.issueDate}
              onChange={e => updateHeader("issueDate", e.target.value || today())}
              className={inputCls}
            />
          </Field>
          <Field label="회사 *">
            <select
              value={header.company}
              onChange={e => updateHeader("company", e.target.value)}
              className={inputCls}
            >
              {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="지역 *">
            <select
              value={header.region}
              onChange={e => updateHeader("region", e.target.value)}
              className={inputCls}
            >
              {regionsOf(header.company).map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </div>
      </section>

      {/* 수정 모드: 검색 영역 + 결과 리스트 */}
      {editMode && (
        <section className="rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 overflow-hidden">
          <header className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between flex-wrap gap-2">
            <span className="text-[11px] font-bold tracking-widest text-amber-700 dark:text-amber-300 uppercase">기존 전표 검색</span>
            {selectedHitId && (
              <button
                type="button"
                onClick={deleteSelected}
                className="text-xs px-2.5 py-1 rounded bg-red-500 hover:bg-red-600 text-white"
                title="선택된 전표 1건 삭제"
              >
                선택 전표 삭제
              </button>
            )}
          </header>

          {/* 검색 조건 */}
          <div className="p-3 flex flex-wrap items-center gap-2 border-b border-amber-100 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-900/10">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 w-10">기간</span>
            <input
              type="date"
              value={searchFrom}
              onChange={e => setSearchFrom(e.target.value || today())}
              className="h-8 px-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100"
            />
            <span className="text-xs text-gray-500">~</span>
            <input
              type="date"
              value={searchTo}
              onChange={e => setSearchTo(e.target.value || today())}
              className="h-8 px-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100"
            />

            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 ml-3 w-10">현장</span>
            <div className="relative">
              <input
                type="search"
                value={searchSite}
                onChange={e => setSearchSite(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
                placeholder="현장명 검색"
                className="h-8 pl-7 pr-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 w-[240px]"
              />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
              {searchSite && (
                <button type="button" onClick={() => setSearchSite("")} className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-xs w-5 h-5 flex items-center justify-center" title="지우기">×</button>
              )}
            </div>

            <button
              type="button"
              onClick={runSearch}
              disabled={searchLoading}
              className={`h-8 px-3 rounded text-xs font-semibold text-white ${searchLoading ? "bg-blue-300" : "bg-blue-600 hover:bg-blue-700"}`}
            >
              {searchLoading ? "검색 중..." : "검색"}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
              총 {searchResults.length}건
            </span>
          </div>

          {/* 검색 결과 리스트 */}
          <div className="overflow-auto max-h-[240px]">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-center w-[90px]">발행일</th>
                  <th className="px-2 py-1.5 text-center w-[50px]">회사</th>
                  <th className="px-2 py-1.5 text-center w-[60px]">지역</th>
                  <th className="px-2 py-1.5 text-left">현 장 명</th>
                  <th className="px-2 py-1.5 text-left">계약 내역</th>
                  <th className="px-2 py-1.5 text-right w-[100px]">견적가</th>
                  <th className="px-2 py-1.5 text-right w-[100px]">확정가</th>
                  <th className="px-2 py-1.5 text-right w-[100px]">자재비</th>
                  <th className="px-2 py-1.5 text-center w-[70px]"></th>
                </tr>
              </thead>
              <tbody>
                {searchResults.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400 dark:text-gray-500">검색 결과가 없습니다.</td></tr>
                )}
                {searchResults.map(hit => {
                  const selected = selectedHitId === hit.id;
                  return (
                    <tr key={hit.id} className={`border-t border-gray-100 dark:border-gray-800 cursor-pointer ${selected ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-gray-50 dark:hover:bg-gray-800/50"}`} onClick={() => pickForEdit(hit)}>
                      <td className="px-2 py-1.5 text-center text-gray-700 dark:text-gray-200 whitespace-nowrap">{fmtDate(hit.issueDate)}</td>
                      <td className="px-2 py-1.5 text-center text-gray-700 dark:text-gray-200">{hit.company}</td>
                      <td className="px-2 py-1.5 text-center text-gray-700 dark:text-gray-200">{hit.region}</td>
                      <td className="px-2 py-1.5 text-left text-gray-800 dark:text-gray-100">{hit.site}</td>
                      <td className="px-2 py-1.5 text-left text-gray-700 dark:text-gray-200">{hit.contract || "-"}</td>
                      <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-200">{fmtNum(hit.quote)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-200">{fmtNum(hit.fixed)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-700 dark:text-gray-200">{fmtNum(hit.material)}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); pickForEdit(hit); }}
                          className={`text-[11px] px-2 py-0.5 rounded ${selected ? "bg-blue-600 text-white" : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"}`}
                        >
                          {selected ? "선택됨" : "선택"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 요약 툴바 */}
      <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          {!editMode && (
            <button
              type="button"
              onClick={addLine}
              className="text-xs px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              + 행 추가
            </button>
          )}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {editMode
              ? (selectedHitId ? "수정 대상 1건이 선택되었습니다." : "왼쪽 리스트에서 수정할 전표를 선택하세요.")
              : `총 ${lines.length}행 · 유효 ${validLines.length}건`}
          </span>
        </div>
        <div className="text-xs text-gray-700 dark:text-gray-200 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>견적 <b className="font-semibold text-gray-900 dark:text-gray-100">{fmtNum(total.d)}</b></span>
          <span>자재비 <b className="font-semibold text-gray-900 dark:text-gray-100">{fmtNum(total.f)}</b></span>
          <span>순수자재비 <b className="font-semibold text-gray-900 dark:text-gray-100">{fmtDec(total.h)}</b></span>
          <span className="text-emerald-700 dark:text-emerald-300">인센티브 <b className="font-bold">{fmtDec(total.i)}</b></span>
        </div>
      </div>

      {/* 아이템(라인) 표 */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        <header className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <span className="text-[11px] font-bold tracking-widest text-indigo-500 dark:text-indigo-300 uppercase">
            {editMode ? "수정 대상" : "아이템 라인"}
          </span>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
              <tr>
                <th className="px-2 py-2 text-center font-semibold w-[40px]">#</th>
                <th className="px-2 py-2 text-center font-semibold w-[240px]">현 장 명 *</th>
                <th className="px-2 py-2 text-center font-semibold w-[200px]">계약 내역</th>
                <th className="px-2 py-2 text-center font-semibold w-[110px]">견적가</th>
                <th className="px-2 py-2 text-center font-semibold w-[110px]">확정가</th>
                <th className="px-2 py-2 text-center font-semibold w-[110px]">자재비</th>
                <th className="px-2 py-2 text-center font-semibold w-[100px] bg-amber-50 dark:bg-amber-900/20">Nego(40%)</th>
                <th className="px-2 py-2 text-center font-semibold w-[110px] bg-amber-50 dark:bg-amber-900/20">순수자재비</th>
                <th className="px-2 py-2 text-center font-semibold w-[100px] bg-emerald-50 dark:bg-emerald-900/20">인센티브</th>
                <th className="px-2 py-2 text-center font-semibold w-[140px]">비고</th>
                {!editMode && <th className="px-2 py-2 w-[36px]"></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const { nego, pure, incentive } = computeMetrics(l);
                const isBlank = !l.site.trim();
                return (
                  <tr key={l.id} className={`border-t border-gray-200 dark:border-gray-700 ${isBlank ? "bg-gray-50/50 dark:bg-gray-800/30" : ""}`}>
                    <td className="px-2 py-1 text-center text-gray-400">{idx + 1}</td>
                    <td className="px-1.5 py-1">
                      <SiteCellSelect
                        value={l.site}
                        onChange={name => updateLine(l.id, { site: name })}
                        sites={sites}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        value={l.contract}
                        onChange={e => updateLine(l.id, { contract: e.target.value })}
                        className="w-full h-7 px-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        inputMode="numeric"
                        value={l.quote === 0 ? "" : l.quote.toLocaleString()}
                        onChange={e => updateLine(l.id, { quote: parseNum(e.target.value) })}
                        className="w-full h-7 px-1 text-right rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        inputMode="numeric"
                        value={l.fixed === 0 ? "" : l.fixed.toLocaleString()}
                        onChange={e => updateLine(l.id, { fixed: parseNum(e.target.value) })}
                        className="w-full h-7 px-1 text-right rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        inputMode="numeric"
                        value={l.material === 0 ? "" : l.material.toLocaleString()}
                        onChange={e => updateLine(l.id, { material: parseNum(e.target.value) })}
                        className="w-full h-7 px-1 text-right rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                      />
                    </td>
                    <td className="px-2 py-1 text-right text-gray-700 dark:text-gray-200 bg-amber-50/60 dark:bg-amber-900/10">{fmtDec(nego)}</td>
                    <td className="px-2 py-1 text-right text-gray-700 dark:text-gray-200 bg-amber-50/60 dark:bg-amber-900/10">{fmtDec(pure)}</td>
                    <td className="px-2 py-1 text-right font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-900/10">{fmtDec(incentive)}</td>
                    <td className="px-1.5 py-1">
                      <input
                        value={l.remark}
                        onChange={e => updateLine(l.id, { remark: e.target.value })}
                        onKeyDown={e => {
                          if (!editMode && e.key === "Enter" && idx === linesRef.current.length - 1) {
                            e.preventDefault();
                            addLine();
                          }
                        }}
                        className="w-full h-7 px-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                      />
                    </td>
                    {!editMode && (
                      <td className="px-1 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(l.id)}
                          title="행 삭제"
                          className="w-6 h-6 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/70 font-semibold text-gray-800 dark:text-gray-100">
                <td colSpan={2} className="px-2 py-2 text-right">합계 (유효 {validLines.length}건)</td>
                <td></td>
                <td className="px-2 py-2 text-right">{fmtNum(total.d)}</td>
                <td className="px-2 py-2 text-right">{fmtNum(total.e)}</td>
                <td className="px-2 py-2 text-right">{fmtNum(total.f)}</td>
                <td className="px-2 py-2 text-right bg-amber-50 dark:bg-amber-900/20">{fmtDec(total.g)}</td>
                <td className="px-2 py-2 text-right bg-amber-50 dark:bg-amber-900/20">{fmtDec(total.h)}</td>
                <td className="px-2 py-2 text-right bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">{fmtDec(total.i)}</td>
                <td colSpan={editMode ? 1 : 2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* 하단 액션 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 sticky bottom-0 py-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-t border-gray-100 dark:border-gray-800">
        {!editMode ? (
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 select-none">
            <input
              type="checkbox"
              checked={continuous}
              onChange={e => setContinuous(e.target.checked)}
              className="w-4 h-4"
            />
            저장 후 계속 입력 (헤더 유지)
          </label>
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {selectedHitId ? "폼에서 값을 바꾼 뒤 [저장]하면 UPDATE 됩니다." : "리스트에서 전표를 먼저 선택하세요."}
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToList}
            className="h-10 px-4 rounded-md text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
            title="목록으로 이동"
          >
            리스트
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="h-10 px-4 rounded-md text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
            title="입력 초기화"
          >
            다시 작성
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || (editMode && !selectedHitId)}
            className={`h-10 px-6 rounded-md text-sm font-semibold text-white ${
              saving || (editMode && !selectedHitId) ? "bg-blue-300 cursor-not-allowed" : editMode ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {saving ? "저장 중..." : editMode ? "수정 저장" : `저장 (${validLines.length}건)`}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full h-9 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

// 표 셀 사이즈에 맞춘 검색 셀렉트 (managed_sites)
function SiteCellSelect({ value, onChange, sites }: { value: string; onChange: (name: string) => void; sites: SiteOption[] }) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      const inRoot = rootRef.current?.contains(target);
      const inDropdown = document.getElementById("site-entry-dropdown-portal")?.contains(target);
      if (!inRoot && !inDropdown) {
        setOpen(false);
        if (!sites.some(s => s.name === query)) setQuery(value);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, query, value, sites]);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const update = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 2, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? sites.filter(s => s.name.toLowerCase().includes(q)) : sites;

  function select(name: string) { setQuery(name); onChange(name); setOpen(false); }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        lang="ko"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (e.target.value === "") onChange(""); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === "Enter" && query.trim() && filtered.length >= 1) {
            e.preventDefault();
            select(filtered[0].name);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery(value);
          }
        }}
        placeholder="현장 검색"
        autoComplete="off"
        className="w-full h-7 pl-1 pr-5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
      />
      {query && (
        <button
          type="button"
          onClick={() => { setQuery(""); onChange(""); setOpen(false); }}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600 hover:text-red-500 text-xs w-4 h-4 flex items-center justify-center"
          title="지우기"
        >×</button>
      )}
      {open && pos && (
        <div id="site-entry-dropdown-portal" style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}>
          {filtered.length > 0 && (
            <ul className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg overflow-y-auto max-h-56">
              {filtered.slice(0, 40).map(s => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => select(s.name)}
                    className={`w-full text-left px-2 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${s.name === value ? "font-semibold text-blue-600 dark:text-blue-300" : "text-gray-800 dark:text-gray-200"}`}
                  >
                    {s.name}
                  </button>
                </li>
              ))}
              {filtered.length > 40 && (
                <li className="px-2 py-1 text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-700">
                  {filtered.length}건 중 상위 40건만 표시. 더 좁혀서 검색하세요.
                </li>
              )}
            </ul>
          )}
          {q !== "" && filtered.length === 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg px-2 py-2 text-[11px] text-gray-500 dark:text-gray-400">
              목록에 없는 현장이지만 입력한 이름으로 저장됩니다: <span className="text-gray-800 dark:text-gray-100 font-semibold">&ldquo;{query}&rdquo;</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
