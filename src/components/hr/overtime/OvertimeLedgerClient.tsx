"use client";

import { useState, useEffect, useCallback } from "react";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { calcOvertimeResult } from "./overtimeCalc";

export const OT_LEDGER_MENU_HREF = "/hr/overtime-ledger";

interface Account {
  id: number;
  username: string;
  dept: string | null;
}

interface OTRow {
  id: number;
  report_no: string;
  author_id: number;
  site_name: string;
  work_instructor: string | null;
  work_reasons: string[];
  work_reason_etc: string | null;
  work_elevator: string | null;
  start_at: string;
  end_at: string;
  is_holiday: boolean;
  holiday_type: string | null;
  work_hours: number | null;
  holiday_hours: number | null;
  overtime_hours: number | null;
  workers: string[];
  work_content: string | null;
  work_result: string | null;
  note: string | null;
  approver_id: number | null;
  approved_at: string | null;
  approval_status: string;
}

export default function OvertimeLedgerClient() {
  const { user } = useAuth();
  const isManager = user ? (isAdmin(user) || hasMenuPermission(user, OT_LEDGER_MENU_HREF, "update")) : false;

  const [rows, setRows] = useState<OTRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState("");
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()));
  const [monthFilter, setMonthFilter] = useState("");
  const [detail, setDetail] = useState<OTRow | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const PAGE = 500;
    const all: OTRow[] = [];
    for (let off = 0; ; off += PAGE) {
      let q = supabase
        .from("overtime_reports")
        .select("*")
        .eq("approval_status", "approved")
        .order("approved_at", { ascending: false })
        .range(off, off + PAGE - 1);
      if (!isManager) q = q.eq("author_id", user.id);
      const { data } = await q;
      const batch = (data as OTRow[] | null) ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    setRows(all);
  }, [user, isManager]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("accounts").select("id, username, dept").order("username");
      setAccounts((data as Account[] | null) ?? []);
    })();
  }, []);

  useEffect(() => { load(); }, [load]);
  useReloadOnActivate(load);

  const years = Array.from(
    new Set(rows.map(r => r.start_at.slice(0, 4)))
  ).sort((a, b) => b.localeCompare(a));

  const filtered = rows.filter(r => {
    const dt = r.start_at.slice(0, 7); // YYYY-MM
    if (yearFilter && !dt.startsWith(yearFilter)) return false;
    if (monthFilter && dt.slice(5, 7) !== monthFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const author = accounts.find(a => a.id === r.author_id);
      if (
        !r.site_name.toLowerCase().includes(q) &&
        !r.report_no.toLowerCase().includes(q) &&
        !(author?.username ?? "").toLowerCase().includes(q) &&
        !(r.work_instructor ?? "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // 합계 계산
  const totalWork     = filtered.reduce((s, r) => s + (r.work_hours ?? 0), 0);
  const totalHoliday  = filtered.reduce((s, r) => s + (r.holiday_hours ?? 0), 0);
  const totalOvertime = filtered.reduce((s, r) => s + (r.overtime_hours ?? 0), 0);

  function fmt(h: number) { return h % 1 === 0 ? `${h}H` : `${h.toFixed(1)}H`; }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h1 className="text-base font-bold">잔업보고서 등록대장</h1>
        <span className="text-xs text-gray-400">{filtered.length}건</span>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <select
          value={yearFilter}
          onChange={e => setYearFilter(e.target.value)}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none">
          <option value="">전체 연도</option>
          {years.map(y => <option key={y}>{y}</option>)}
          {!years.includes(yearFilter) && yearFilter && <option value={yearFilter}>{yearFilter}</option>}
        </select>
        <select
          value={monthFilter}
          onChange={e => setMonthFilter(e.target.value)}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none">
          <option value="">전체 월</option>
          {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map(m => (
            <option key={m} value={m}>{Number(m)}월</option>
          ))}
        </select>
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="현장명 / 보고서번호 / 작성자 검색"
          className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 w-56" />
      </div>

      {/* 합계 바 */}
      {filtered.length > 0 && (
        <div className="flex gap-4 px-4 py-2 bg-blue-50 dark:bg-blue-950/20 border-b border-blue-100 dark:border-blue-900 text-xs shrink-0">
          <span>총 근무: <b className="text-blue-700 dark:text-blue-300">{fmt(totalWork)}</b></span>
          <span>휴일근무: <b className="text-orange-600 dark:text-orange-300">{fmt(totalHoliday)}</b></span>
          <span>잔업: <b className="text-purple-600 dark:text-purple-300">{fmt(totalOvertime)}</b></span>
        </div>
      )}

      {/* 목록 */}
      <div className="flex-1 overflow-auto p-4">
        {filtered.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-16">승인 완료된 잔업보고서가 없습니다.</div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 uppercase text-[11px]">
                <tr>
                  <th className="px-3 py-2 text-left">보고서번호</th>
                  <th className="px-3 py-2 text-left">현장명</th>
                  <th className="px-3 py-2 text-left">작업일시</th>
                  <th className="px-3 py-2 text-center">휴일</th>
                  <th className="px-3 py-2 text-center">근무</th>
                  <th className="px-3 py-2 text-center">잔업</th>
                  <th className="px-3 py-2 text-left">작업사유</th>
                  {isManager && <th className="px-3 py-2 text-left">작성자</th>}
                  <th className="px-3 py-2 text-center">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map(r => {
                  const s = new Date(r.start_at);
                  const e = new Date(r.end_at);
                  const author = accounts.find(a => a.id === r.author_id);
                  const ot = calcOvertimeResult(s, e, r.is_holiday);
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                      <td className="px-3 py-2 font-mono text-gray-500">{r.report_no}</td>
                      <td className="px-3 py-2 font-medium">{r.site_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div>{s.toLocaleDateString("ko-KR")}</div>
                        <div className="text-gray-400">
                          {s.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                          {" ~ "}
                          {e.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.is_holiday
                          ? <span className="text-orange-500 font-medium">{r.holiday_type ?? "휴일"}</span>
                          : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-medium text-blue-600 dark:text-blue-400">
                        {r.work_hours != null ? fmt(r.work_hours) : "-"}
                      </td>
                      <td className="px-3 py-2 text-center font-medium text-purple-600 dark:text-purple-400">
                        {r.overtime_hours != null ? fmt(r.overtime_hours) : "-"}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                        {r.work_reasons.join(", ")}
                        {r.work_reason_etc ? ` (${r.work_reason_etc})` : ""}
                      </td>
                      {isManager && (
                        <td className="px-3 py-2">{author?.username ?? "-"}</td>
                      )}
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => setDetail(r)}
                          className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                          보기
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 상세 모달 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">잔업보고서</span>
                <span className="text-xs font-mono text-gray-400">{detail.report_no}</span>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <div className="p-4 space-y-4 text-xs">
              {(() => {
                const s = new Date(detail.start_at);
                const e = new Date(detail.end_at);
                const author = accounts.find(a => a.id === detail.author_id);
                const approver = accounts.find(a => a.id === detail.approver_id);
                const ot = calcOvertimeResult(s, e, detail.is_holiday);
                return (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div><span className="text-gray-400">현장명</span><p className="font-medium mt-0.5">{detail.site_name}</p></div>
                      <div><span className="text-gray-400">작업지시자</span><p className="font-medium mt-0.5">{detail.work_instructor ?? "-"}</p></div>
                      <div><span className="text-gray-400">작업사유</span><p className="font-medium mt-0.5">{detail.work_reasons.join(", ") || "-"}{detail.work_reason_etc ? ` (${detail.work_reason_etc})` : ""}</p></div>
                      <div><span className="text-gray-400">작업호기</span><p className="font-medium mt-0.5">{detail.work_elevator ?? "-"}</p></div>
                    </div>
                    <div className="border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 rounded p-3">
                      <p className="text-gray-500 mb-1">작업일시</p>
                      <p className="font-medium">
                        {s.toLocaleDateString("ko-KR")} {s.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        {" ~ "}
                        {e.toLocaleDateString("ko-KR")} {e.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {detail.is_holiday && (
                        <p className="text-orange-600 dark:text-orange-300 mt-0.5">{detail.holiday_type ?? "휴일"}</p>
                      )}
                      <p className="text-blue-700 dark:text-blue-300 font-semibold mt-1">{ot.display}</p>
                    </div>
                    <div>
                      <span className="text-gray-400">작업자명</span>
                      <p className="mt-0.5">{detail.workers.filter(Boolean).join(", ") || "-"}</p>
                    </div>
                    {detail.work_content && (
                      <div>
                        <span className="text-gray-400">작업내용</span>
                        <p className="mt-0.5 whitespace-pre-wrap bg-gray-50 dark:bg-gray-700 rounded p-2">{detail.work_content}</p>
                      </div>
                    )}
                    {detail.work_result && (
                      <div>
                        <span className="text-gray-400">작업결과</span>
                        <p className="mt-0.5 whitespace-pre-wrap bg-gray-50 dark:bg-gray-700 rounded p-2">{detail.work_result}</p>
                      </div>
                    )}
                    {detail.note && (
                      <div><span className="text-gray-400">비고</span><p className="mt-0.5">{detail.note}</p></div>
                    )}
                    <div className="grid grid-cols-2 gap-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                      <div><span className="text-gray-400">작성자</span><p className="font-medium mt-0.5">{author?.username ?? "-"}</p></div>
                      <div><span className="text-gray-400">승인자</span><p className="font-medium mt-0.5">{approver?.username ?? "-"}</p></div>
                      <div><span className="text-gray-400">승인일시</span><p className="font-medium mt-0.5">{detail.approved_at ? new Date(detail.approved_at).toLocaleString("ko-KR") : "-"}</p></div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
