"use client";

import { useEffect, useState } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import {
  TBMRecord, TBMParticipant, TBMRecordSafetyRule, TBMChecklistResult, TBMPhoto,
  TBMEnvReading, TBMHeatRest,
  MODE_LABELS, SUB_TYPE_LABELS,
} from "@/lib/tbm";
import { heatStressLevel } from "@/lib/apparent-temperature";
import TBMParticipantConfirmModal from "./TBMParticipantConfirmModal";
import EditTBMModal from "./EditTBMModal";
import { deleteTbmRecord } from "./tbmDelete";

interface DetailData {
  participants: TBMParticipant[];
  rules: TBMRecordSafetyRule[];
  checklist: TBMChecklistResult[];
  photos: TBMPhoto[];
  envReadings: TBMEnvReading[];
  heatRests: TBMHeatRest[];
}

type Role = "writer" | "participant" | "viewer";
type Filter = "all" | "mine" | "participating";

interface ListTBM extends TBMRecord {
  role: Role;
  myConfirmedAt: string | null;
}

const PAGE_SIZE = 30;

export default function TBMMyList() {
  const { user } = useAuth();
  const admin = user ? isAdmin(user) : false;

  const [records, setRecords] = useState<ListTBM[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("mine");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirming, setConfirming] = useState<ListTBM | null>(null);
  const [editing, setEditing] = useState<ListTBM | null>(null);

  async function load(p = 0, append = false) {
    if (!user) return;
    setLoading(true);

    // 본인 참가자로 등록된 TBM IDs (역할 판정용)
    const partRes = await supabase.from("tbm_participants")
      .select("tbm_id, confirmed_at")
      .eq("user_id", user.id);
    const myParticipations = new Map<number, string | null>();
    ((partRes.data ?? []) as { tbm_id: number; confirmed_at: string | null }[]).forEach(p => {
      myParticipations.set(p.tbm_id, p.confirmed_at);
    });

    // 메인 쿼리 (필터별)
    let q = supabase.from("tbm_records").select("*")
      .order("created_at", { ascending: false })
      .range(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);  // PAGE_SIZE+1 가져와서 hasMore 판단

    if (filter === "mine") {
      const partIds = [...myParticipations.keys()];
      if (partIds.length > 0) {
        q = q.or(`user_id.eq.${user.id},id.in.(${partIds.join(",")})`);
      } else {
        q = q.eq("user_id", user.id);
      }
    } else if (filter === "participating") {
      const partIds = [...myParticipations.keys()];
      if (partIds.length === 0) {
        setRecords([]); setHasMore(false); setLoading(false); return;
      }
      q = q.in("id", partIds);
    }

    const { data } = await q;
    const rows = (data ?? []) as TBMRecord[];
    const more = rows.length > PAGE_SIZE;
    const visibleRows = more ? rows.slice(0, PAGE_SIZE) : rows;

    const mapped: ListTBM[] = visibleRows.map(r => {
      let role: Role;
      let myConf: string | null = null;
      if (r.user_id === user.id) role = "writer";
      else if (myParticipations.has(r.id)) {
        role = "participant";
        myConf = myParticipations.get(r.id) ?? null;
      } else role = "viewer";
      return { ...r, role, myConfirmedAt: myConf };
    });

    setRecords(prev => append ? [...prev, ...mapped] : mapped);
    setHasMore(more);
    setLoading(false);
  }

  useEffect(() => { setPage(0); load(0, false); /* eslint-disable-next-line */ }, [user, filter]);
  useReloadOnActivate(() => { setPage(0); void load(0, false); });

  async function loadDetail(id: number) {
    if (openId === id) {
      setOpenId(null); setDetail(null); return;
    }
    setOpenId(id); setDetailLoading(true); setDetail(null);
    const [p, r, c, ph, en, hr] = await Promise.all([
      supabase.from("tbm_participants").select("*").eq("tbm_id", id),
      supabase.from("tbm_record_safety_rules").select("*").eq("tbm_id", id),
      supabase.from("tbm_checklist_results").select("*").eq("tbm_id", id),
      supabase.from("tbm_photos").select("*").eq("tbm_id", id).order("uploaded_at"),
      supabase.from("tbm_env_readings").select("*").eq("tbm_id", id).order("seq"),
      supabase.from("tbm_heat_rests").select("*").eq("tbm_id", id).order("seq"),
    ]);
    setDetail({
      participants: (p.data ?? []) as TBMParticipant[],
      rules: (r.data ?? []) as TBMRecordSafetyRule[],
      checklist: (c.data ?? []) as TBMChecklistResult[],
      photos: (ph.data ?? []) as TBMPhoto[],
      envReadings: (en.data ?? []) as TBMEnvReading[],
      heatRests: (hr.data ?? []) as TBMHeatRest[],
    });
    setDetailLoading(false);
  }

  async function deleteTbm(id: number) {
    if (!confirm("이 TBM 기록을 삭제하시겠습니까?\n(연관된 참가자/사진/안전수칙/체크리스트도 함께 삭제됩니다)")) return;
    try {
      await deleteTbmRecord(id);
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (openId === id) { setOpenId(null); setDetail(null); }
    load(0, false);
  }

  function loadMore() {
    const next = page + 1;
    setPage(next);
    load(next, true);
  }

  if (loading && records.length === 0) {
    return <div className="p-6 text-center text-sm text-gray-500">로딩 중...</div>;
  }

  return (
    <div className="space-y-3">
      {/* 필터 칩 */}
      <div className="flex gap-1.5 flex-wrap">
        {([
          ["mine", "내 TBM (작성+참가)"],
          ["participating", "내가 참가"],
          ["all", "전체"],
        ] as [Filter, string][]).map(([f, label]) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1 text-[11px] font-semibold rounded-full border ${
              filter === f
                ? "bg-slate-700 text-white border-slate-700"
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {records.length === 0 ? (
        <div className="p-12 text-center">
          <div className="text-5xl mb-3">📋</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">조건에 해당하는 TBM이 없습니다.</div>
        </div>
      ) : (
        records.map(r => {
          const opened = openId === r.id;
          const dt = new Date(r.created_at);
          const dtStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")} ${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`;
          const modeColor = r.mode === "repair"
            ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"
            : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300";

          // 권한: 본인 작성 또는 admin이면 수정/삭제 가능
          const canEditDelete = r.role === "writer" || admin;

          return (
            <div key={r.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button type="button" onClick={() => loadDetail(r.id)}
                className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${modeColor}`}>
                    {MODE_LABELS[r.mode]}{r.sub_type ? ` · ${SUB_TYPE_LABELS[r.sub_type]}` : ""}
                  </span>
                  {r.role === "writer" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                      작성자
                    </span>
                  )}
                  {r.role === "participant" && (
                    <>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                        참가자
                      </span>
                      {r.myConfirmedAt ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                          ✓ 확인 완료
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                          ⚠️ 미확인
                        </span>
                      )}
                    </>
                  )}
                  {r.role === "viewer" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      조회
                    </span>
                  )}
                  <span className="text-[11px] text-gray-400 ml-auto">{dtStr}</span>
                </div>
                <div className="text-sm font-bold text-gray-900 dark:text-white">
                  {r.site_name} {r.elevator_name && <span className="text-gray-500 dark:text-gray-400 font-normal">{r.elevator_name}</span>}
                </div>
                {r.role !== "writer" && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">작성: {r.user_name}</div>
                )}
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">{r.work_content}</div>
              </button>

              {opened && (
                <div className="border-t border-gray-100 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/50 space-y-3">
                  {detailLoading ? (
                    <div className="text-xs text-gray-500 text-center py-3">불러오는 중...</div>
                  ) : detail ? (
                    <>
                      {r.risk_assessment && (
                        <Section title="위험요소">
                          <p className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{r.risk_assessment}</p>
                        </Section>
                      )}
                      {detail.envReadings.length > 0 && (
                        <Section title={`환경지표 (${detail.envReadings.length}건)`}>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px] border-collapse">
                              <thead>
                                <tr className="bg-white dark:bg-gray-800">
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">시각</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">온도(℃)</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">습도(%)</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">체감</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">지역</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.envReadings.map(x => {
                                  const info = heatStressLevel(x.apparent_temperature);
                                  return (
                                    <tr key={x.id} className="text-center text-gray-700 dark:text-gray-200">
                                      <td className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">{x.observed_at?.slice(0,5) ?? "-"}</td>
                                      <td className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">{x.temperature ?? "-"}</td>
                                      <td className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">{x.humidity ?? "-"}</td>
                                      <td className={`border px-1.5 py-1 ${info?.colorClass ?? "border-gray-200 dark:border-gray-700"}`}>
                                        {x.apparent_temperature ?? "-"}
                                        {info && <span className="ml-1 font-bold">({info.label})</span>}
                                      </td>
                                      <td className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">{x.location ?? "-"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </Section>
                      )}
                      {detail.heatRests.length > 0 && (
                        <Section title={`온열질환 예방 휴게 (${detail.heatRests.length}건)`}>
                          <ul className="space-y-1">
                            {detail.heatRests.map(x => (
                              <li key={x.id} className="text-xs text-gray-700 dark:text-gray-200">
                                ✓ 휴게 {x.rest_start?.slice(0,5) ?? "-"} ~ {x.rest_end?.slice(0,5) ?? "-"}
                                {x.rest_method && ` · ${x.rest_method}`}
                              </li>
                            ))}
                          </ul>
                        </Section>
                      )}
                      {detail.checklist.length > 0 && (
                        <Section title={`체크리스트 (${detail.checklist.filter(c => c.is_checked).length}/${detail.checklist.length})`}>
                          <ul className="space-y-1">
                            {detail.checklist.map(c => (
                              <li key={c.item_id} className="text-xs flex gap-2">
                                <span className={c.is_checked ? "text-green-600" : "text-gray-400"}>{c.is_checked ? "✓" : "○"}</span>
                                <span className={c.is_checked ? "text-gray-700 dark:text-gray-200" : "text-gray-400 dark:text-gray-500"}>{c.item_label}</span>
                              </li>
                            ))}
                          </ul>
                        </Section>
                      )}
                      {detail.rules.length > 0 && (
                        <Section title={`안전수칙 (${detail.rules.length})`}>
                          <ul className="space-y-1">
                            {detail.rules.map(rl => (
                              <li key={rl.rule_id} className="text-xs text-gray-700 dark:text-gray-200">⚠️ {rl.rule_text}</li>
                            ))}
                          </ul>
                        </Section>
                      )}
                      {detail.participants.length > 0 && (
                        <Section title={`참가자 (${detail.participants.length})`}>
                          <div className="flex flex-wrap gap-1">
                            {detail.participants.map(p => (
                              <span key={p.user_id}
                                className={`text-[11px] px-2 py-0.5 rounded-full ${
                                  p.confirmed_at
                                    ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                                    : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                                }`}>
                                {p.confirmed_at && "✓ "}{p.user_name}
                              </span>
                            ))}
                          </div>
                        </Section>
                      )}
                      {detail.photos.length > 0 && (
                        <Section title={`사진 (${detail.photos.length})`}>
                          <div className="grid grid-cols-3 gap-2">
                            {detail.photos.map(ph => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <a key={ph.id} href={ph.photo_url} target="_blank" rel="noopener noreferrer">
                                <img src={ph.photo_url} alt="" className="w-full aspect-square object-cover rounded" />
                              </a>
                            ))}
                          </div>
                        </Section>
                      )}
                      {r.signature_url && (
                        <Section title="작성자 서명">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.signature_url} alt="작성자 서명" className="h-20 bg-white rounded border border-gray-200" />
                        </Section>
                      )}

                      {/* 액션 버튼 */}
                      <div className="flex gap-2">
                        {canEditDelete && (
                          <button type="button" onClick={() => setEditing(r)}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                            ✏️ 수정
                          </button>
                        )}
                        {canEditDelete && (
                          <button type="button" onClick={() => deleteTbm(r.id)}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20">
                            🗑️ 삭제
                          </button>
                        )}
                        {r.role === "participant" && (
                          <button type="button" onClick={() => setConfirming(r)}
                            className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700">
                            ✍️ {r.myConfirmedAt ? "재확인" : "참가자 확인"}
                          </button>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          );
        })
      )}

      {hasMore && (
        <button type="button" onClick={loadMore}
          className="w-full py-2.5 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
          더 보기
        </button>
      )}

      {confirming && (
        <TBMParticipantConfirmModal
          record={confirming}
          onClose={() => setConfirming(null)}
          onSaved={() => { setConfirming(null); load(0, false); setPage(0); }}
        />
      )}

      {editing && (
        <EditTBMModal
          record={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(0, false); setPage(0); }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">{title}</div>
      {children}
    </div>
  );
}

// ============================================================
// 수정 모달 (기본 텍스트 필드만)
// ============================================================

