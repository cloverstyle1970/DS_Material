"use client";

import { useEffect, useState } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  TBMRecord, TBMParticipant, TBMRecordSafetyRule, TBMChecklistResult, TBMPhoto,
  TBMMode, MODE_LABELS, SUB_TYPE_LABELS,
} from "@/lib/tbm";

interface DetailData {
  participants: TBMParticipant[];
  rules: TBMRecordSafetyRule[];
  checklist: TBMChecklistResult[];
  photos: TBMPhoto[];
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

  const [editing, setEditing] = useState<TBMRecord | null>(null);
  const [editForm, setEditForm] = useState({
    site_name: "", elevator_name: "", work_content: "", risk_assessment: "",
    parts_name: "", passenger_trapped: false,
  });
  const [editSaving, setEditSaving] = useState(false);

  const PAGE_SIZE = 30;

  // -------- 권한 체크 --------
  if (!user) {
    return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  }
  if (!isAdmin(user)) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">관리자 권한이 필요합니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">TBM 관리 페이지는 관리자만 접근할 수 있습니다.</div>
      </div>
    );
  }

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
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [modeFilter, fromDate, toDate, page]);

  async function loadDetail(rec: TBMRecord) {
    setOpenDetail(rec);
    setDetail(null);
    setDetailLoading(true);
    const [p, r, c, ph] = await Promise.all([
      supabase.from("tbm_participants").select("*").eq("tbm_id", rec.id),
      supabase.from("tbm_record_safety_rules").select("*").eq("tbm_id", rec.id),
      supabase.from("tbm_checklist_results").select("*").eq("tbm_id", rec.id),
      supabase.from("tbm_photos").select("*").eq("tbm_id", rec.id).order("uploaded_at"),
    ]);
    setDetail({
      participants: (p.data ?? []) as TBMParticipant[],
      rules: (r.data ?? []) as TBMRecordSafetyRule[],
      checklist: (c.data ?? []) as TBMChecklistResult[],
      photos: (ph.data ?? []) as TBMPhoto[],
    });
    setDetailLoading(false);
  }

  function startEdit(rec: TBMRecord) {
    setEditing(rec);
    setEditForm({
      site_name: rec.site_name,
      elevator_name: rec.elevator_name,
      work_content: rec.work_content,
      risk_assessment: rec.risk_assessment,
      parts_name: rec.parts_name,
      passenger_trapped: rec.passenger_trapped,
    });
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editForm.site_name.trim() || !editForm.work_content.trim()) {
      alert("현장명과 작업 내용은 필수입니다."); return;
    }
    setEditSaving(true);
    const { error } = await supabase.from("tbm_records").update({
      site_name: editForm.site_name.trim(),
      elevator_name: editForm.elevator_name.trim(),
      work_content: editForm.work_content.trim(),
      risk_assessment: editForm.risk_assessment.trim(),
      parts_name: editing.sub_type === "parts" ? editForm.parts_name.trim() : "",
      passenger_trapped: editing.sub_type === "fault" ? editForm.passenger_trapped : false,
      updated_at: new Date().toISOString(),
    }).eq("id", editing.id);
    setEditSaving(false);
    if (error) { alert(`저장 실패: ${error.message}`); return; }
    setEditing(null);
    setOpenDetail(null);
    load();
  }

  async function deleteTbm(id: number) {
    if (!confirm("이 TBM 기록을 삭제하시겠습니까?\n(연관된 참가자/사진/안전수칙/체크리스트도 함께 삭제됩니다)")) return;
    const { error } = await supabase.from("tbm_records").delete().eq("id", id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
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
                <tr className="text-left text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  <th className="px-4 py-2.5">일시</th>
                  <th className="px-4 py-2.5">작성자</th>
                  <th className="px-4 py-2.5">구분</th>
                  <th className="px-4 py-2.5">현장 / 호기</th>
                  <th className="px-4 py-2.5">작업 내용</th>
                  <th className="px-4 py-2.5 text-right">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-gray-500">로딩 중...</td></tr>
                )}
                {!loading && records.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-xs text-gray-500">조건에 해당하는 기록이 없습니다.</td></tr>
                )}
                {!loading && records.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">{fmtDt(r.created_at)}</td>
                    <td className="px-4 py-2.5 text-xs font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">{r.user_name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{modeBadge(r)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      <div className="font-semibold">{r.site_name}</div>
                      {r.elevator_name && <div className="text-gray-500 dark:text-gray-400">{r.elevator_name}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-300 max-w-md truncate">{r.work_content}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button type="button" onClick={() => loadDetail(r)}
                        className="px-2 py-1 text-[11px] rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
                        상세
                      </button>
                      <button type="button" onClick={() => startEdit(r)}
                        className="ml-1 px-2 py-1 text-[11px] rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/70">
                        수정
                      </button>
                      <button type="button" onClick={() => deleteTbm(r.id)}
                        className="ml-1 px-2 py-1 text-[11px] rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/70">
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
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
      {openDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpenDetail(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <div className="text-base font-bold text-gray-900 dark:text-white">TBM 상세</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  #{openDetail.id} · {fmtDt(openDetail.created_at)} · {openDetail.user_name}
                </div>
              </div>
              <button onClick={() => setOpenDetail(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

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
                          {detail.participants.map(p => {
                            const dt = p.confirmed_at ? new Date(p.confirmed_at) : null;
                            const dtStr = dt
                              ? `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")} ${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`
                              : null;
                            return (
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
                                {dtStr && <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-auto">{dtStr}</span>}
                                {p.signature_url && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={p.signature_url} alt="서명" className="h-6 bg-white rounded border border-gray-200" />
                                )}
                              </div>
                            );
                          })}
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
                  {openDetail.signature_url && (
                    <DetailRow label="서명">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={openDetail.signature_url} alt="서명" className="h-24 bg-white rounded border border-gray-200" />
                    </DetailRow>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button type="button" onClick={() => deleteTbm(openDetail.id)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20">
                삭제
              </button>
              <button type="button" onClick={() => startEdit(openDetail)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700">
                기본정보 수정
              </button>
              <button type="button" onClick={() => setOpenDetail(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 수정 모달 */}
      {editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="text-base font-bold text-gray-900 dark:text-white">TBM 기본정보 수정</div>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <EditField label="현장명 *">
                <input type="text" value={editForm.site_name} onChange={e => setEditForm(f => ({...f, site_name: e.target.value}))} lang="ko"
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
              </EditField>
              <EditField label="호기">
                <input type="text" value={editForm.elevator_name} onChange={e => setEditForm(f => ({...f, elevator_name: e.target.value}))} lang="ko"
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
              </EditField>
              {editing.sub_type === "parts" && (
                <EditField label="교체 부품명">
                  <input type="text" value={editForm.parts_name} onChange={e => setEditForm(f => ({...f, parts_name: e.target.value}))} lang="ko"
                    className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
                </EditField>
              )}
              {editing.sub_type === "fault" && (
                <EditField label="승객 갇힘 여부">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={editForm.passenger_trapped}
                      onChange={e => setEditForm(f => ({...f, passenger_trapped: e.target.checked}))} />
                    승객 갇힘 발생
                  </label>
                </EditField>
              )}
              <EditField label="작업 내용 *">
                <textarea value={editForm.work_content} onChange={e => setEditForm(f => ({...f, work_content: e.target.value}))} rows={4} lang="ko"
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 resize-none" />
              </EditField>
              <EditField label="위험요소">
                <textarea value={editForm.risk_assessment} onChange={e => setEditForm(f => ({...f, risk_assessment: e.target.value}))} rows={2} lang="ko"
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 resize-none" />
              </EditField>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                ※ 모드/서브타입/체크리스트/안전수칙/참가자/사진/서명은 작성자가 직접 다시 작성해야 합니다.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                취소
              </button>
              <button type="button" onClick={saveEdit} disabled={editSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {editSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
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

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  );
}
