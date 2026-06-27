"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { useViewMode } from "@/context/ViewModeContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { fmtNum } from "@/lib/format";

const MENU_HREF = "/accounting/sales-invoices";
const PAGE_SIZE = 50;

interface InvoiceRow {
  id: number;
  row_no: number | null;
  category: string | null;       // 보수 / 부품
  tax_div: string | null;
  issue_date: string | null;     // YYYY-MM-DD
  issue_raw: string | null;
  summary: string | null;
  site_name: string | null;
  vendor_name: string | null;
  amount: number | null;
  deposit_date: string | null;
  deposit_raw: string | null;
  deposit_bank: string | null;
  pay_status: string | null;     // 완/미/취/중/대/실
  pay_method: string | null;
  remark: string | null;
  ledger_no: string | null;
  contact: string | null;
  long_overdue: string | null;
}

interface SearchResult {
  total_count: number;
  total_amount: number;
  unpaid_amount: number;
  rows: InvoiceRow[];
}

// 결제상태 코드 → 라벨·색상
const STATUS_META: Record<string, { label: string; cls: string }> = {
  "완": { label: "입금완료", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  "미": { label: "미수",     cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  "취": { label: "취소",     cls: "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  "중": { label: "수금중",   cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  "대": { label: "대손",     cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  "실": { label: "실효",     cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};
const STATUS_CODES = ["완", "미", "취", "중", "대", "실"];

function statusBadge(code: string | null) {
  const m = code ? STATUS_META[code] : undefined;
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${m?.cls ?? "bg-gray-100 text-gray-500"}`}>
      {m?.label ?? (code || "-")}
    </span>
  );
}
function fmtDate(d: string | null) { return d ? d.slice(2).replace(/-/g, ".") : "-"; }  // 2026-06-15 → 26.06.15

// 과세구분 T=TK(파랑) / D=DS(빨강)
function taxBadge(code: string | null) {
  if (code !== "T" && code !== "D") return <span className="text-gray-400">-</span>;
  const isTk = code === "T";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${isTk
      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"}`}>
      {isTk ? "TK" : "DS"}
    </span>
  );
}

// ── 엑셀 파싱 (import 스크립트와 동일 규칙) ──
function parseYmd(raw: unknown): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;
  const mm = Number(m[2]), dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${2000 + Number(m[1])}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
function parseDeposit(raw: unknown): { date: string | null; bank: string | null } {
  if (!raw) return { date: null, bank: null };
  const s = String(raw).trim();
  const m = s.match(/\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*(.*)$/);
  return { date: parseYmd(s), bank: m && m[1] ? m[1].trim() || null : null };
}
function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const TX = (v: unknown): string | null => { const s = (v ?? "").toString().trim(); return s === "" ? null : s; };

// 현재 분기 시작·종료일 (YYYY-MM-DD)
function currentQuarter(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const startMonth = Math.floor(now.getMonth() / 3) * 3;   // 0,3,6,9
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${y}-${pad(startMonth + 1)}-01`;
  const lastDay = new Date(y, startMonth + 3, 0).getDate();
  const to = `${y}-${pad(startMonth + 3)}-${pad(lastDay)}`;
  return { from, to };
}

export default function SalesInvoicesClient() {
  const { user } = useAuth();
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const canUpload = !!user && (isAdmin(user) || hasMenuPermission(user, MENU_HREF, "update"));

  // 필터
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<"" | "보수" | "부품">("부품");   // 기본: 부품교체
  const [taxDiv, setTaxDiv] = useState<"" | "T" | "D">("D");                // 기본: DS
  const [status, setStatus] = useState<string>("완");                       // 기본: 입금완료
  const [from, setFrom] = useState(() => currentQuarter().from);            // 기본: 해당 분기
  const [to, setTo] = useState(() => currentQuarter().to);
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [page, setPage] = useState(0);

  const [result, setResult] = useState<SearchResult>({ total_count: 0, total_amount: 0, unpaid_amount: 0, rows: [] });
  const [loading, setLoading] = useState(false);

  // 업로드 상태
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<{ type: "info" | "success" | "error"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("sales_invoices_search", {
        p_q: q.trim() || null,
        p_category: category || null,
        p_status: status || null,
        p_from: from || null,
        p_to: to || null,
        p_unpaid_only: unpaidOnly,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
        p_tax_div: taxDiv || null,
      });
      if (error) throw error;
      setResult(data as SearchResult);
    } catch (e) {
      console.error("[sales-invoices] 조회 실패:", e);
      setResult({ total_count: 0, total_amount: 0, unpaid_amount: 0, rows: [] });
    } finally {
      setLoading(false);
    }
  }, [q, category, taxDiv, status, from, to, unpaidOnly, page]);

  // 필터 변경 시 1페이지로 리셋 후 조회 (검색어는 디바운스)
  useEffect(() => { setPage(0); }, [q, category, taxDiv, status, from, to, unpaidOnly]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
  }, [load]);
  useReloadOnActivate(load);

  const totalPages = Math.max(1, Math.ceil(result.total_count / PAGE_SIZE));

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (!confirm(`"${file.name}" 의 전체 내용으로 발행내역을 교체합니다.\n기존 데이터는 모두 삭제됩니다. 진행할까요?`)) return;

    setUploading(true);
    setUploadMsg({ type: "info", text: "엑셀을 읽는 중..." });
    try {
      const XLSX = (await import("xlsx")).default;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });

      const records: Record<string, unknown>[] = [];
      for (let i = 3; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;
        if (!(TX(r[4]) || TX(r[6]) || TX(r[8]) || TX(r[5]))) continue;
        const dep = parseDeposit(r[9]);
        records.push({
          row_no: i,
          year_label: TX(r[0]), month_label: TX(r[1]),
          category: TX(r[2]), tax_div: TX(r[3]),
          issue_date: parseYmd(r[4]), issue_raw: TX(r[4]),
          summary: TX(r[5]), site_name: TX(r[6]), vendor_name: TX(r[7]),
          amount: parseAmount(r[8]),
          deposit_date: dep.date, deposit_raw: TX(r[9]), deposit_bank: dep.bank,
          pay_status: TX(r[10]), pay_method: TX(r[11]),
          remark: TX(r[12]), ledger_no: TX(r[13]), contact: TX(r[14]),
          etc: TX(r[15]), long_overdue: TX(r[16]),
        });
      }
      if (records.length === 0) { setUploadMsg({ type: "error", text: "유효한 데이터 행이 없습니다. 시트 형식을 확인하세요." }); setUploading(false); return; }

      setUploadMsg({ type: "info", text: `${records.length}건 파싱 완료. 기존 데이터 삭제 중...` });
      const del = await supabase.from("sales_invoices").delete().gte("id", 0);
      if (del.error) throw del.error;

      const BATCH = 500;
      for (let i = 0; i < records.length; i += BATCH) {
        const slice = records.slice(i, i + BATCH);
        const { error } = await supabase.from("sales_invoices").insert(slice);
        if (error) throw error;
        setUploadMsg({ type: "info", text: `적재 중... ${Math.min(i + BATCH, records.length)}/${records.length}` });
      }
      setUploadMsg({ type: "success", text: `업로드 완료: ${records.length}건으로 교체되었습니다.` });
      setPage(0);
      await load();
    } catch (err) {
      console.error("[sales-invoices] 업로드 실패:", err);
      setUploadMsg({ type: "error", text: `업로드 실패: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setUploading(false);
    }
  }

  const inputCls = "px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400";
  const cardCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700";

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">🧾 계산서 발행내역</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">매출 세금계산서 발행·입금·미수 현황을 조회합니다.</p>
        </div>
        {canUpload && (
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".xls,.xlsx" onChange={handleFile} className="hidden" />
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {uploading ? "업로드 중..." : "⬆ 엑셀 재업로드"}
            </button>
          </div>
        )}
      </div>

      <div className="p-6 space-y-4 max-w-[1600px]">
        {uploadMsg && (
          <div className={`px-4 py-2.5 rounded-lg text-sm ${
            uploadMsg.type === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            : uploadMsg.type === "error" ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"}`}>
            {uploadMsg.text}
          </div>
        )}

        {/* 필터 */}
        <div className={`${cardCls} p-4 flex flex-wrap items-end gap-3`}>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">검색 (현장·상호·적요·원장번호)</label>
            <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="검색어 입력" className={inputCls + " w-full"} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">TK/DS</label>
            <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded-lg">
              {([["", "전체", "bg-gray-900 text-white"], ["D", "DS", "bg-red-500 text-white"], ["T", "TK", "bg-blue-600 text-white"]] as const).map(([v, label, activeCls]) => (
                <button key={v} type="button" onClick={() => setTaxDiv(v as "" | "T" | "D")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    taxDiv === v ? `${activeCls} shadow-sm` : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">구분</label>
            <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-700 p-0.5 rounded-lg">
              {([["", "전체"], ["보수", "보수료"], ["부품", "부품교체"]] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setCategory(v as "" | "보수" | "부품")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    category === v ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">결제상태</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
              <option value="">전체</option>
              {STATUS_CODES.map(c => <option key={c} value={c}>{STATUS_META[c].label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">발행일 (시작)</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">발행일 (종료)</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer select-none px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600">
            <input type="checkbox" checked={unpaidOnly} onChange={e => setUnpaidOnly(e.target.checked)} className="accent-red-500" />
            <span className="text-xs font-semibold text-red-600 dark:text-red-300">미수만</span>
          </label>
          {(q || category || taxDiv || status || from || to || unpaidOnly) && (
            <button type="button" onClick={() => { setQ(""); setCategory(""); setTaxDiv(""); setStatus(""); setFrom(""); setTo(""); setUnpaidOnly(false); }}
              className="px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">초기화</button>
          )}
        </div>

        {/* 요약 */}
        <div className="grid grid-cols-3 gap-3">
          <div className={`${cardCls} px-4 py-3`}>
            <div className="text-xs text-gray-500 dark:text-gray-400">건수</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{fmtNum(result.total_count)}건</div>
          </div>
          <div className={`${cardCls} px-4 py-3`}>
            <div className="text-xs text-gray-500 dark:text-gray-400">청구금액 합계</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{fmtNum(result.total_amount)}원</div>
          </div>
          <div className={`${cardCls} px-4 py-3`}>
            <div className="text-xs text-gray-500 dark:text-gray-400">미수 합계</div>
            <div className="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">{fmtNum(result.unpaid_amount)}원</div>
          </div>
        </div>

        {/* 목록 */}
        <div className={`${cardCls} overflow-hidden`}>
          {isMobile ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {result.rows.map(r => (
                <div key={r.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{fmtDate(r.issue_date)}</span>
                    <div className="flex items-center gap-1.5">
                      {taxBadge(r.tax_div)}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{r.category === "부품" ? "부품교체" : r.category === "보수" ? "보수료" : (r.category ?? "-")}</span>
                      {statusBadge(r.pay_status)}
                    </div>
                  </div>
                  <div className="font-medium text-gray-800 dark:text-gray-100">{r.site_name ?? "-"}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{r.summary ?? "-"}</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-300">{r.vendor_name ?? "-"}</span>
                    <span className="font-bold tabular-nums text-gray-900 dark:text-white">{fmtNum(r.amount)}원</span>
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">입금 {fmtDate(r.deposit_date)}{r.deposit_bank ? ` · ${r.deposit_bank}` : ""}{r.pay_method ? ` · ${r.pay_method}` : ""}</div>
                </div>
              ))}
              {result.rows.length === 0 && !loading && <div className="p-8 text-center text-sm text-gray-400">결과가 없습니다.</div>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 text-[11px] font-bold text-gray-600 dark:text-gray-300">
                  <tr>
                    <th className="px-3 py-2 text-center w-24">발행일</th>
                    <th className="px-3 py-2 text-center w-16">TK/DS</th>
                    <th className="px-3 py-2 text-center w-20">구분</th>
                    <th className="px-3 py-2 text-left">현장명</th>
                    <th className="px-3 py-2 text-left">상호</th>
                    <th className="px-3 py-2 text-left">적요</th>
                    <th className="px-3 py-2 text-right w-28">청구금액</th>
                    <th className="px-3 py-2 text-center w-24">입금일</th>
                    <th className="px-3 py-2 text-center w-20">결제상태</th>
                    <th className="px-3 py-2 text-center w-20">결제방식</th>
                    <th className="px-3 py-2 text-left w-24">원장번호</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map(r => (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-3 py-2 text-center font-mono tabular-nums whitespace-nowrap text-gray-600 dark:text-gray-300">{fmtDate(r.issue_date)}</td>
                      <td className="px-3 py-2 text-center">{taxBadge(r.tax_div)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.category === "부품" ? "부품교체" : r.category === "보수" ? "보수료" : (r.category ?? "-")}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-100 max-w-[200px] truncate" title={r.site_name ?? ""}>{r.site_name ?? "-"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[180px] truncate" title={r.vendor_name ?? ""}>{r.vendor_name ?? "-"}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[260px] truncate" title={r.summary ?? ""}>{r.summary ?? "-"}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-white whitespace-nowrap">{fmtNum(r.amount)}</td>
                      <td className="px-3 py-2 text-center font-mono tabular-nums whitespace-nowrap text-gray-600 dark:text-gray-300">{fmtDate(r.deposit_date)}</td>
                      <td className="px-3 py-2 text-center">{statusBadge(r.pay_status)}</td>
                      <td className="px-3 py-2 text-center text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.pay_method ?? "-"}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap">{r.ledger_no ?? "-"}</td>
                    </tr>
                  ))}
                  {result.rows.length === 0 && !loading && (
                    <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-gray-400">결과가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* 페이지네이션 */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {loading ? "조회 중..." : `${fmtNum(result.total_count)}건 중 ${result.total_count === 0 ? 0 : page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, result.total_count)}`}
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" disabled={page === 0} onClick={() => setPage(0)}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700">«</button>
              <button type="button" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700">‹ 이전</button>
              <span className="text-xs text-gray-600 dark:text-gray-300 px-2 tabular-nums">{page + 1} / {totalPages}</span>
              <button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700">다음 ›</button>
              <button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage(totalPages - 1)}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700">»</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
