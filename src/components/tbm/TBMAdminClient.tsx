"use client";

import { useEffect, useState } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";
import {
  TBMRecord, TBMParticipant, TBMRecordSafetyRule, TBMChecklistResult, TBMPhoto,
  TBMEnvReading, TBMHeatRest,
  TBMMode, MODE_LABELS, SUB_TYPE_LABELS,
} from "@/lib/tbm";
import { heatStressLevel } from "@/lib/apparent-temperature";
import { printTBMReport } from "./tbmReportPrint";
import { deleteTbmRecord } from "./tbmDelete";
import EditTBMModal from "./EditTBMModal";

interface DetailData {
  participants: TBMParticipant[];
  rules: TBMRecordSafetyRule[];
  checklist: TBMChecklistResult[];
  photos: TBMPhoto[];
  envReadings: TBMEnvReading[];
  heatRests: TBMHeatRest[];
}

type ModeFilter = "all" | TBMMode;

export default function TBMAdminClient() {
  const { user } = useAuth();

  const [records, setRecords] = useState<TBMRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const [openDetail, setOpenDetail] = useState<TBMRecord | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [participantStats, setParticipantStats] = useState<Map<number, { total: number; confirmed: number }>>(new Map());
  const [editing, setEditing] = useState<TBMRecord | null>(null);

  const PAGE_SIZE = 30;

  // -------- 권한 체크 --------
  if (!user) {
    return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  }
  if (!hasMenuPermission(user, "/safety/tbm/admin", "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">TBM 관리 메뉴 권한이 필요합니다.</div>
      </div>
    );
  }
  const canWrite = hasMenuPermission(user, "/safety/tbm/admin", "create") || hasMenuPermission(user, "/safety/tbm/admin", "update");

  // -------- 데이터 로드 --------
  async function load() {
    setLoading(true);
    let q = supabase.from("tbm_records")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (modeFilter !== "all") q = q.eq("mode", modeFilter);
    if (fromDate) q = q.gte("created_at", `${fromDate}T00:00:00`);
    if (toDate)   q = q.lte("created_at", `${toDate}T23:59:59`);
    const { data, count } = await q;
    let rows = (data ?? []) as TBMRecord[];
    if (searchText.trim()) {
      const s = searchText.trim().toLowerCase();
      rows = rows.filter(r =>
        r.site_name.toLowerCase().includes(s) ||
        r.elevator_name.toLowerCase().includes(s) ||
        r.user_name.toLowerCase().includes(s) ||
        r.work_content.toLowerCase().includes(s)
      );
    }
    setRecords(rows);
    setTotal(count ?? 0);

    // 참가자 확인 통계 로드
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const { data: parts } = await supabase.from("tbm_participants")
        .select("tbm_id, confirmed_at")
        .in("tbm_id", ids);
      const stats = new Map<number, { total: number; confirmed: number }>();
      (parts ?? []).forEach((p: { tbm_id: number; confirmed_at: string | null }) => {
        const cur = stats.get(p.tbm_id) ?? { total: 0, confirmed: 0 };
        cur.total++;
        if (p.confirmed_at) cur.confirmed++;
        stats.set(p.tbm_id, cur);
      });
      setParticipantStats(stats);
    } else {
      setParticipantStats(new Map());
    }

    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [modeFilter, fromDate, toDate, page]);
  useReloadOnActivate(() => { void load(); });

  async function fetchDetail(recId: number): Promise<DetailData> {
    const [p, r, c, ph, en, hr] = await Promise.all([
      supabase.from("tbm_participants").select("*").eq("tbm_id", recId),
      supabase.from("tbm_record_safety_rules").select("*").eq("tbm_id", recId),
      supabase.from("tbm_checklist_results").select("*").eq("tbm_id", recId),
      supabase.from("tbm_photos").select("*").eq("tbm_id", recId).order("uploaded_at"),
      supabase.from("tbm_env_readings").select("*").eq("tbm_id", recId).order("seq"),
      supabase.from("tbm_heat_rests").select("*").eq("tbm_id", recId).order("seq"),
    ]);
    return {
      participants: (p.data ?? []) as TBMParticipant[],
      rules: (r.data ?? []) as TBMRecordSafetyRule[],
      checklist: (c.data ?? []) as TBMChecklistResult[],
      photos: (ph.data ?? []) as TBMPhoto[],
      envReadings: (en.data ?? []) as TBMEnvReading[],
      heatRests: (hr.data ?? []) as TBMHeatRest[],
    };
  }

  async function loadDetail(rec: TBMRecord) {
    setOpenDetail(rec);
    setDetail(null);
    setDetailLoading(true);
    setDetail(await fetchDetail(rec.id));
    setDetailLoading(false);
  }

  async function openPdf(rec: TBMRecord) {
    try {
      // 상세 모달이 열려있고 데이터가 이미 로드된 경우 재사용
      const d = openDetail?.id === rec.id && detail ? detail : await fetchDetail(rec.id);
      printTBMReport({ record: rec, ...d });
    } catch (e) {
      alert(`PDF 출력 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function startEdit(rec: TBMRecord) {
    setEditing(rec);
  }

  async function deleteTbm(id: number) {
    if (!confirm("이 TBM 기록을 삭제하시겠습니까?\n(연관된 참가자/사진/안전수칙/체크리스트도 함께 삭제됩니다)")) return;
    try {
      await deleteTbmRecord(id);
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setOpenDetail(null);
    load();
  }

  function fmtDt(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }

  function modeBadge(rec: TBMRecord) {
    const cls = rec.mode === "repair"
      ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"
      : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300";
    return (
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>
        {MODE_LABELS[rec.mode]}{rec.sub_type ? ` · ${SUB_TYPE_LABELS[rec.sub_type]}` : ""}
      </span>
    );
  }

  const pageCount = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">TBM 관리</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          전체 TBM 기록 조회·수정·삭제 (총 {total}건)
        </p>
      </div>

      {/* 필터 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {(["all","repair","maintain"] as ModeFilter[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setModeFilter(m); setPage(0); }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full border ${
                  modeFilter === m
                    ? "bg-slate-700 text-white border-slate-700"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600"
                }`}
              >
                {m === "all" ? "전체" : MODE_LABELS[m as TBMMode]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <span>기간</span>
            <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }}
              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs" />
            <span>~</span>
            <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }}
              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs" />
          </div>

          <div className="flex-1 min-w-[200px] max-w-md flex gap-2">
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") load(); }}
              placeholder="현장·호기·작성자·작업내용 검색"
              lang="ko"
              className="flex-1 px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs"
            />
            <button type="button" onClick={() => load()}
              className="px-3 py-1.5 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800">
              검색
            </button>
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="px-6 py-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <tr className="text-center text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  <th className="px-4 py-2.5">일시</th>
                  <th className="px-4 py-2.5">작성자</th>
                  <th className="px-4 py-2.5">구분</th>
                  <th className="px-4 py-2.5">현장 / 호기</th>
                  <th className="px-4 py-2.5">작업 내용</th>
                  <th className="px-4 py-2.5">참가자 확인</th>
                  <th className="px-4 py-2.5">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-gray-500">로딩 중...</td></tr>
                )}
                {!loading && records.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-xs text-gray-500">조건에 해당하는 기록이 없습니다.</td></tr>
                )}
                {!loading && records.map(r => {
                  const stats = participantStats.get(r.id);
                  const hasPending = !!stats && stats.total > 0 && stats.confirmed < stats.total;
                  // 참가자 미확인 시 빨간 글씨 (다크/라이트 동일)
                  const rowText = hasPending
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-700 dark:text-gray-200";
                  const rowMutedText = hasPending
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-600 dark:text-gray-300";
                  return (
                    <tr key={r.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${hasPending ? "bg-red-50/50 dark:bg-red-900/10" : ""}`}>
                      <td className={`px-4 py-2.5 text-center text-xs whitespace-nowrap ${rowMutedText}`}>{fmtDt(r.created_at)}</td>
                      <td className={`px-4 py-2.5 text-center text-xs font-semibold whitespace-nowrap ${hasPending ? "text-red-600 dark:text-red-400" : "text-gray-800 dark:text-gray-100"}`}>{r.user_name}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">{modeBadge(r)}</td>
                      <td className={`px-4 py-2.5 text-center text-xs whitespace-nowrap ${rowText}`}>
                        <div className="font-semibold">{r.site_name}</div>
                        {r.elevator_name && <div className={hasPending ? "" : "text-gray-500 dark:text-gray-400"}>{r.elevator_name}</div>}
                      </td>
                      <td className={`px-4 py-2.5 text-center text-xs max-w-md truncate ${rowMutedText}`}>{r.work_content}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        {stats && stats.total > 0 ? (
                          <span className={`text-[11px] font-bold ${hasPending ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                            {stats.confirmed}/{stats.total}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <button type="button" onClick={() => loadDetail(r)}
                          className="px-2 py-1 text-[11px] rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
                          상세
                        </button>
                        <button type="button" onClick={() => openPdf(r)}
                          className="ml-1 px-2 py-1 text-[11px] rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/70">
                          PDF
                        </button>
                        {canWrite && (
                          <>
                            <button type="button" onClick={() => startEdit(r)}
                              className="ml-1 px-2 py-1 text-[11px] rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/70">
                              수정
                            </button>
                            <button type="button" onClick={() => deleteTbm(r.id)}
                              className="ml-1 px-2 py-1 text-[11px] rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/70">
                              삭제
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-xs">
              <div className="text-gray-500 dark:text-gray-400">
                {page + 1} / {pageCount}
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40">이전</button>
                <button type="button" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                  className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40">다음</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 상세 모달 */}
      <DraggableModal
        open={!!openDetail}
        onClose={() => setOpenDetail(null)}
        panelClassName="w-full max-w-2xl max-h-[90vh]"
        header={
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <div className="text-base font-bold text-gray-900 dark:text-white">TBM 상세</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                #{openDetail?.id} · {openDetail && fmtDt(openDetail.created_at)} · {openDetail?.user_name}
              </div>
            </div>
            <button onClick={() => setOpenDetail(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        }
      >
        {openDetail && (<>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex flex-wrap gap-2 items-center">
                {modeBadge(openDetail)}
                {openDetail.passenger_trapped && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                    🔴 승객 갇힘
                  </span>
                )}
              </div>

              <DetailRow label="현장 / 호기">
                <span className="font-semibold">{openDetail.site_name}</span>
                {openDetail.elevator_name && <span className="text-gray-500 dark:text-gray-400 ml-2">{openDetail.elevator_name}</span>}
              </DetailRow>

              {openDetail.parts_name && <DetailRow label="교체 부품"><span>{openDetail.parts_name}</span></DetailRow>}

              <DetailRow label="작업 내용">
                <p className="whitespace-pre-wrap">{openDetail.work_content}</p>
              </DetailRow>

              {openDetail.risk_assessment && (
                <DetailRow label="위험요소 / 특이사항">
                  <p className="whitespace-pre-wrap">{openDetail.risk_assessment}</p>
                </DetailRow>
              )}

              {detailLoading ? (
                <div className="text-xs text-gray-500 text-center py-3">상세 로딩 중...</div>
              ) : detail && (
                <>
                  {detail.envReadings.length > 0 && (
                    <DetailRow label={`환경지표 (${detail.envReadings.length}건)`}>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                              <th className="border border-gray-200 dark:border-gray-600 px-2 py-1 w-16">시각</th>
                              <th className="border border-gray-200 dark:border-gray-600 px-2 py-1 w-16">온도(℃)</th>
                              <th className="border border-gray-200 dark:border-gray-600 px-2 py-1 w-16">습도(%)</th>
                              <th className="border border-gray-200 dark:border-gray-600 px-2 py-1 w-24">체감온도</th>
                              <th className="border border-gray-200 dark:border-gray-600 px-2 py-1 text-left">지역정보</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.envReadings.map(x => {
                              const info = heatStressLevel(x.apparent_temperature);
                              return (
                                <tr key={x.id} className="text-center text-gray-700 dark:text-gray-200">
                                  <td className="border border-gray-200 dark:border-gray-600 px-2 py-1">{x.observed_at?.slice(0,5) ?? "-"}</td>
                                  <td className="border border-gray-200 dark:border-gray-600 px-2 py-1">{x.temperature ?? "-"}</td>
                                  <td className="border border-gray-200 dark:border-gray-600 px-2 py-1">{x.humidity ?? "-"}</td>
                                  <td className={`border px-2 py-1 ${info?.colorClass ?? "border-gray-200 dark:border-gray-600"}`}>
                                    {x.apparent_temperature ?? "-"}
                                    {info && <span className="ml-1 font-bold">({info.label})</span>}
                                  </td>
                                  <td className="border border-gray-200 dark:border-gray-600 px-2 py-1 text-left">{x.location ?? "-"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </DetailRow>
                  )}
                  {detail.heatRests.length > 0 && (
                    <DetailRow label={`온열질환 예방 휴게 실시 (${detail.heatRests.length}건)`}>
                      <ul className="space-y-1">
                        {detail.heatRests.map(x => (
                          <li key={x.id} className="text-xs text-gray-700 dark:text-gray-200">
                            ✓ 휴게 {x.rest_start?.slice(0,5) ?? "-"} ~ {x.rest_end?.slice(0,5) ?? "-"}
                            {x.rest_method && ` · ${x.rest_method}`}
                          </li>
                        ))}
                      </ul>
                    </DetailRow>
                  )}
                  {detail.checklist.length > 0 && (
                    <DetailRow label={`체크리스트 (${detail.checklist.filter(c => c.is_checked).length}/${detail.checklist.length})`}>
                      <ul className="space-y-1">
                        {detail.checklist.map(c => (
                          <li key={c.item_id} className="text-xs flex gap-2">
                            <span className={c.is_checked ? "text-green-600" : "text-gray-400"}>{c.is_checked ? "✓" : "○"}</span>
                            <span className={c.is_checked ? "text-gray-700 dark:text-gray-200" : "text-gray-400 dark:text-gray-500"}>{c.item_label}</span>
                          </li>
                        ))}
                      </ul>
                    </DetailRow>
                  )}
                  {detail.rules.length > 0 && (
                    <DetailRow label={`안전수칙 (${detail.rules.length})`}>
                      <ul className="space-y-1">
                        {detail.rules.map(rl => (
                          <li key={rl.rule_id} className="text-xs">⚠️ {rl.rule_text}</li>
                        ))}
                      </ul>
                    </DetailRow>
                  )}
                  {detail.participants.length > 0 && (() => {
                    const confirmedCount = detail.participants.filter(p => p.confirmed_at).length;
                    return (
                      <DetailRow label={`참가자 ${confirmedCount}/${detail.participants.length} 확인 완료`}>
                        <div className="space-y-1.5">
                          {detail.participants.map(p => (
                            <div key={p.user_id}
                              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                                p.confirmed_at
                                  ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20"
                                  : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30"
                              }`}>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                p.confirmed_at
                                  ? "bg-green-500 text-white"
                                  : "bg-gray-300 dark:bg-gray-600 text-gray-600 dark:text-gray-300"
                              }`}>
                                {p.confirmed_at ? "✓ 확인" : "미확인"}
                              </span>
                              <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{p.user_name}</span>
                              {p.signature_url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.signature_url} alt="서명" className="ml-auto h-6 bg-white rounded border border-gray-200" />
                              )}
                            </div>
                          ))}
                        </div>
                      </DetailRow>
                    );
                  })()}
                  {detail.photos.length > 0 && (
                    <DetailRow label={`사진 (${detail.photos.length})`}>
                      <div className="grid grid-cols-4 gap-2">
                        {detail.photos.map(ph => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a key={ph.id} href={ph.photo_url} target="_blank" rel="noopener noreferrer">
                            <img src={ph.photo_url} alt="" className="w-full aspect-square object-cover rounded border border-gray-200 dark:border-gray-700" />
                          </a>
                        ))}
                      </div>
                    </DetailRow>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button type="button" onClick={() => openPdf(openDetail)} disabled={detailLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                🖨️ PDF 출력
              </button>
              {canWrite && (
                <>
                  <button type="button" onClick={() => deleteTbm(openDetail.id)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20">
                    삭제
                  </button>
                  <button type="button" onClick={() => startEdit(openDetail)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700">
                    기본정보 수정
                  </button>
                </>
              )}
              <button type="button" onClick={() => setOpenDetail(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
                닫기
              </button>
            </div>
        </>)}
      </DraggableModal>

      {editing && (
        <EditTBMModal
          record={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setOpenDetail(null); load(); }}
        />
      )}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">{label}</div>
      <div className="text-sm text-gray-700 dark:text-gray-200">{children}</div>
    </div>
  );
}

