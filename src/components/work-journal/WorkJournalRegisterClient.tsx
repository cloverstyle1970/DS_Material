"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import { printWorkJournal, type JournalPrintHeader, type JournalPrintItem, type JournalPrintEnv, type JournalPrintRest, type JournalPrintParticipant } from "./workJournalPrint";

const HREF = "/safety/work-journal-register";

const inputCls =
  "px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400";

interface JournalRow extends JournalPrintHeader {
  _items: number;
  _signed: number;
  _workers: number;
}

type CatFilter = "all" | "inspection" | "fault" | "repair";

export default function WorkJournalRegisterClient() {
  const { user } = useAuth();

  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fCat, setFCat] = useState<CatFilter>("all");
  const [kw, setKw] = useState("");

  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("work_journals")
      .select("*, work_journal_items(id), work_journal_participants(id, role, signature_url)")
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);

    if (fFrom) q = q.gte("work_date", fFrom);
    if (fTo) q = q.lte("work_date", fTo);
    if (fCat === "inspection") q = q.eq("category_inspection", true);
    if (fCat === "fault") q = q.eq("category_fault", true);
    if (fCat === "repair") q = q.eq("category_repair", true);

    const { data } = await q;
    const list = ((data ?? []) as (JournalPrintHeader & {
      work_journal_items: { id: number }[];
      work_journal_participants: { id: number; role: string; signature_url: string | null }[];
    })[]).map((r) => {
      const workers = (r.work_journal_participants ?? []).filter((p) => /^worker\d+$/.test(p.role));
      return {
        ...r,
        _items: (r.work_journal_items ?? []).length,
        _workers: workers.length,
        _signed: workers.filter((p) => p.signature_url).length,
      } as JournalRow;
    });
    setRows(list);
    setLoading(false);
  }, [fFrom, fTo, fCat]);

  useEffect(() => {
    void load();
  }, [load]);
  useReloadOnActivate(() => {
    void load();
  });

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!hasMenuPermission(user, HREF, "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">작업일지 대장 메뉴 권한이 필요합니다.</div>
      </div>
    );
  }
  const canDelete = hasMenuPermission(user, HREF, "update");

  const kwLc = kw.trim().toLowerCase();
  const view = kwLc
    ? rows.filter(
        (r) =>
          (r.site_name ?? "").toLowerCase().includes(kwLc) ||
          (r.elevator_unique_no ?? "").toLowerCase().includes(kwLc) ||
          (r.user_name ?? "").toLowerCase().includes(kwLc) ||
          (r.special_notes ?? "").toLowerCase().includes(kwLc)
      )
    : rows;

  async function del(r: JournalRow) {
    if (!confirm(`${r.work_date} ${r.site_name} ${r.elevator_unique_no || ""} 작업일지를 삭제할까요?\n(작업내역·휴게·기상·참가자 서명이 함께 삭제됩니다)`)) return;
    const { error } = await supabase.from("work_journals").delete().eq("id", r.id);
    if (error) return alert("삭제 실패: " + error.message);
    if (detailId === r.id) setDetailId(null);
    void load();
  }

  async function print(r: JournalRow) {
    const [it, hr, en, pt] = await Promise.all([
      supabase.from("work_journal_items").select("*").eq("journal_id", r.id).order("seq"),
      supabase.from("work_journal_heat_rests").select("*").eq("journal_id", r.id).order("seq"),
      supabase.from("work_journal_env_readings").select("*").eq("journal_id", r.id).order("seq"),
      supabase.from("work_journal_participants").select("*").eq("journal_id", r.id),
    ]);
    printWorkJournal({
      header: r,
      items: (it.data ?? []) as JournalPrintItem[],
      envReadings: (en.data ?? []) as JournalPrintEnv[],
      rests: (hr.data ?? []) as JournalPrintRest[],
      participants: ((pt.data ?? []) as { role: string; name: string; signature_url: string | null }[]).map((p) => ({
        role: p.role,
        name: p.name,
        signature_url: p.signature_url,
      })),
    });
  }

  function catLabel(r: JournalRow) {
    const c: string[] = [];
    if (r.category_inspection) c.push("점검");
    if (r.category_fault) c.push("고장");
    if (r.category_repair) c.push("수리");
    return c.length ? c.join("·") : "-";
  }

  function overtimeText(r: JournalRow) {
    if (!r.overtime_start && !r.overtime_end && !r.overtime_hours && !r.overtime_minutes) return "-";
    if (r.overtime_hours > 0 || r.overtime_minutes > 0) return `${r.overtime_hours}시간 ${r.overtime_minutes}분`;
    return `${r.overtime_start?.slice(0, 5) ?? "-"} ~ ${r.overtime_end?.slice(0, 5) ?? "-"}`;
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">작업일지대장</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          모든 유지관리 작업일지를 기간·구분·검색으로 조회하고 인쇄·삭제할 수 있습니다.
        </p>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* 필터 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">작업일(부터)</span>
            <input type="date" className={inputCls} value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">작업일(까지)</span>
            <input type="date" className={inputCls} value={fTo} onChange={(e) => setFTo(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">작업구분</span>
            <select className={inputCls} value={fCat} onChange={(e) => setFCat(e.target.value as CatFilter)}>
              <option value="all">전체</option>
              <option value="inspection">점검</option>
              <option value="fault">고장처리</option>
              <option value="repair">수리공사</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">검색(현장·호기·작성자·특이사항)</span>
            <input className={inputCls} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="키워드" />
          </label>
          {(fFrom || fTo || fCat !== "all" || kw) && (
            <button
              type="button"
              onClick={() => {
                setFFrom("");
                setFTo("");
                setFCat("all");
                setKw("");
              }}
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-200"
            >
              초기화
            </button>
          )}
        </div>

        {/* 목록 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center">
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">작업일지 내역</span>
            <span className="ml-2 text-xs text-gray-400">{view.length}건</span>
            {loading && <span className="ml-auto text-xs text-gray-400">불러오는 중…</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300">
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-32">문서번호</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-24">작업일</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">작성자</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-left">현장</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">호기</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">작업구분</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-32">기본근무</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-28">연장</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-16">작업</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-20">서명</th>
                  <th className="border border-gray-200 dark:border-gray-700 px-2 py-2 w-28">관리</th>
                </tr>
              </thead>
              <tbody>
                {view.map((r) => {
                  const doc = `WJ-${r.work_date.replace(/-/g, "")}-${r.id}`;
                  const sigOk = r._workers > 0 && r._signed === r._workers;
                  return (
                    <tr key={r.id} className="text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center font-mono text-[11px] text-gray-500">{doc}</td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">
                        {r.work_date}
                        {r.weekday && <span className="text-gray-400"> ({r.weekday})</span>}
                      </td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">{r.user_name}</td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2">{r.site_name || "-"}</td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">{r.elevator_unique_no || "-"}</td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                          {catLabel(r)}
                        </span>
                      </td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">
                        {r.base_work_start?.slice(0, 5) ?? "-"} ~ {r.base_work_end?.slice(0, 5) ?? "-"}
                      </td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center whitespace-nowrap">{overtimeText(r)}</td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">{r._items}</td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2 text-center">
                        {r._workers > 0 ? (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            sigOk
                              ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                              : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                          }`}>
                            {r._signed}/{r._workers}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="border border-gray-200 dark:border-gray-700 px-2 py-2">
                        <div className="flex gap-1 justify-center">
                          <button
                            type="button"
                            onClick={() => setDetailId(r.id)}
                            className="px-1.5 py-0.5 text-[11px] rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                          >
                            상세
                          </button>
                          <button
                            type="button"
                            onClick={() => print(r)}
                            className="px-1.5 py-0.5 text-[11px] rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                          >
                            인쇄
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => del(r)}
                              className="px-1.5 py-0.5 text-[11px] rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {view.length === 0 && !loading && (
                  <tr>
                    <td colSpan={11} className="border border-gray-200 dark:border-gray-700 px-2 py-10 text-center text-gray-400">
                      조회된 작업일지가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {detailId !== null && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

// ---------- 상세 모달 ----------
function DetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [header, setHeader] = useState<JournalPrintHeader | null>(null);
  const [items, setItems] = useState<JournalPrintItem[]>([]);
  const [rests, setRests] = useState<JournalPrintRest[]>([]);
  const [env, setEnv] = useState<JournalPrintEnv[]>([]);
  const [parts, setParts] = useState<JournalPrintParticipant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [hd, it, hr, en, pt] = await Promise.all([
        supabase.from("work_journals").select("*").eq("id", id).single(),
        supabase.from("work_journal_items").select("*").eq("journal_id", id).order("seq"),
        supabase.from("work_journal_heat_rests").select("*").eq("journal_id", id).order("seq"),
        supabase.from("work_journal_env_readings").select("*").eq("journal_id", id).order("seq"),
        supabase.from("work_journal_participants").select("*").eq("journal_id", id),
      ]);
      setHeader((hd.data ?? null) as JournalPrintHeader | null);
      setItems((it.data ?? []) as JournalPrintItem[]);
      setRests((hr.data ?? []) as JournalPrintRest[]);
      setEnv((en.data ?? []) as JournalPrintEnv[]);
      setParts(((pt.data ?? []) as { role: string; name: string; signature_url: string | null }[]).map((p) => ({
        role: p.role,
        name: p.name,
        signature_url: p.signature_url,
      })));
      setLoading(false);
    })();
  }, [id]);

  const doc = header ? `WJ-${header.work_date.replace(/-/g, "")}-${header.id}` : "";
  const workers = parts
    .filter((p) => /^worker\d+$/.test(p.role))
    .sort((a, b) => parseInt(a.role.slice(6), 10) - parseInt(b.role.slice(6), 10));
  const restRows = rests.filter((x) => x.rest_start || x.rest_end || x.rest_method);

  function print() {
    if (!header) return;
    printWorkJournal({ header, items, envReadings: env, rests, participants: parts });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-4xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">작업일지 상세</h3>
          <span className="text-xs font-mono text-gray-400">{doc}</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={print}
              disabled={!header}
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200 disabled:opacity-50"
            >
              🖨 인쇄
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-200"
            >
              닫기
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">불러오는 중…</div>
          ) : header ? (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-700 dark:text-gray-200">
                <div><b>작업일:</b> {header.work_date}{header.weekday && ` (${header.weekday})`}</div>
                <div><b>작성자:</b> {header.user_name}</div>
                <div><b>현장:</b> {header.site_name}</div>
                <div><b>호기:</b> {header.elevator_unique_no || "-"}</div>
                <div><b>날씨:</b> {header.weather || "-"}{header.temperature !== null && ` · ${header.temperature}℃`}{header.humidity !== null && ` · 습도 ${header.humidity}%`}</div>
                <div><b>체감온도:</b> {header.apparent_temperature ?? "-"}</div>
                <div><b>기본근무:</b> {header.base_work_start?.slice(0, 5) ?? "-"} ~ {header.base_work_end?.slice(0, 5) ?? "-"}</div>
                <div><b>연장:</b> {header.overtime_hours}시간 {header.overtime_minutes}분</div>
              </div>

              {env.length > 0 && (
                <Sub title={`기상정보 (${env.length}건)`}>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300">
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1">시각</th>
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1">온도(℃)</th>
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1">습도(%)</th>
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1">체감</th>
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-left">지역</th>
                      </tr>
                    </thead>
                    <tbody>
                      {env.map((x) => (
                        <tr key={x.seq} className="text-center">
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1">{x.observed_at?.slice(0, 5) ?? "-"}</td>
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1">{x.temperature ?? "-"}</td>
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1">{x.humidity ?? "-"}</td>
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1">{x.apparent_temperature ?? "-"}</td>
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-left">{x.location ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Sub>
              )}

              {items.length > 0 && (
                <Sub title={`작업내역 (${items.length}건)`}>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300">
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1 w-14">호기</th>
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1 w-20">구분</th>
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-left">작업내용</th>
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1 w-28">작업시간</th>
                        <th className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-left w-40">조치결과</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.seq}>
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-center">{it.unit_no}</td>
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-center">{it.work_category}</td>
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1">{it.work_content}</td>
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-center whitespace-nowrap">
                            {(it.work_start || it.work_end)
                              ? `${it.work_start?.slice(0, 5) ?? "-"} ~ ${it.work_end?.slice(0, 5) ?? "-"}`
                              : "-"}
                          </td>
                          <td className="border border-gray-200 dark:border-gray-700 px-2 py-1">{it.action_result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Sub>
              )}

              {restRows.length > 0 && (
                <Sub title={`온열질환 예방 휴게 (${restRows.length}건)`}>
                  <ul className="text-xs space-y-0.5 text-gray-700 dark:text-gray-200">
                    {restRows.map((x) => (
                      <li key={x.seq}>
                        ✓ {x.rest_start?.slice(0, 5) ?? "-"} ~ {x.rest_end?.slice(0, 5) ?? "-"}
                        {x.rest_method && ` · ${x.rest_method}`}
                      </li>
                    ))}
                  </ul>
                </Sub>
              )}

              {header.special_notes && (
                <Sub title="특이사항">
                  <p className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{header.special_notes}</p>
                </Sub>
              )}

              {workers.length > 0 && (
                <Sub title={`참가자 서명 (${workers.filter((w) => w.signature_url).length}/${workers.length})`}>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {workers.map((p) => (
                      <div key={p.role} className="bg-gray-50 dark:bg-gray-900/40 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                        <div className="text-[10px] text-gray-500 dark:text-gray-400">작업자 {parseInt(p.role.slice(6), 10)}</div>
                        <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">{p.name || "-"}</div>
                        {p.signature_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.signature_url} alt="" className="mt-1 h-12 bg-white rounded border border-gray-200" />
                        ) : (
                          <div className="mt-1 h-12 flex items-center justify-center rounded border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                            서명 대기
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Sub>
              )}
            </>
          ) : (
            <div className="p-8 text-center text-sm text-gray-400">일지 정보를 찾을 수 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">{title}</div>
      {children}
    </div>
  );
}
