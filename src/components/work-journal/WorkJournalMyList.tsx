"use client";

import { useEffect, useState } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import { supabase } from "@/lib/supabase";
import WorkJournalAddSignatureModal from "./WorkJournalAddSignatureModal";
import { heatStressLevel } from "@/lib/apparent-temperature";

interface Journal {
  id: number;
  user_id: number;
  user_name: string;
  work_date: string;
  weekday: string | null;
  weather: string | null;
  site_name: string;
  elevator_unique_no: string;
  temperature: number | null;
  humidity: number | null;
  apparent_temperature: number | null;
  base_work_start: string | null;
  base_work_end: string | null;
  overtime_start: string | null;
  overtime_end: string | null;
  overtime_hours: number;
  overtime_minutes: number;
  category_inspection: boolean;
  category_fault: boolean;
  category_repair: boolean;
  special_notes: string;
  location: string | null;
  created_at: string;
}

interface JournalItem {
  id: number;
  seq: number;
  unit_no: string;
  work_category: string;
  work_content: string;
  work_start: string | null;
  work_end: string | null;
  action_result: string;
}

interface EnvReading {
  id: number;
  seq: number;
  observed_at: string | null;
  temperature: number | null;
  humidity: number | null;
  apparent_temperature: number | null;
  location: string | null;
}

interface HeatRest {
  id: number;
  seq: number;
  rest_start: string | null;   // TIME as "HH:MM:SS"
  rest_end:   string | null;
  rest_method: string | null;
}

interface Participant {
  id: number;
  role: string;  // "worker1" | "worker2" | ...
  user_id: number | null;
  name: string;
  signature_url: string | null;
}

interface DetailData {
  items: JournalItem[];
  rests: HeatRest[];
  envReadings: EnvReading[];
  participants: Participant[];
}

type Filter = "mine" | "all";

const PAGE_SIZE = 30;

export default function WorkJournalMyList({ onEdit }: { onEdit?: (id: number) => void }) {
  const { user } = useAuth();
  const admin = user ? isAdmin(user) : false;

  const [records, setRecords] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<Filter>("mine");
  const [page, setPage]       = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [signing, setSigning] = useState<{ participantId: number; name: string; journalId: number } | null>(null);

  async function load(p = 0, append = false) {
    if (!user) return;
    setLoading(true);

    let q = supabase.from("work_journals").select("*")
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

    if (filter === "mine") {
      q = q.eq("user_id", user.id);
    }

    const { data } = await q;
    const rows = (data ?? []) as Journal[];
    const more = rows.length > PAGE_SIZE;
    const visibleRows = more ? rows.slice(0, PAGE_SIZE) : rows;

    setRecords(prev => append ? [...prev, ...visibleRows] : visibleRows);
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
    const [it, hr, en, pt] = await Promise.all([
      supabase.from("work_journal_items").select("*").eq("journal_id", id).order("seq"),
      supabase.from("work_journal_heat_rests").select("*").eq("journal_id", id).order("seq"),
      supabase.from("work_journal_env_readings").select("*").eq("journal_id", id).order("seq"),
      supabase.from("work_journal_participants").select("*").eq("journal_id", id),
    ]);
    setDetail({
      items: (it.data ?? []) as JournalItem[],
      rests: (hr.data ?? []) as HeatRest[],
      envReadings: (en.data ?? []) as EnvReading[],
      participants: (pt.data ?? []) as Participant[],
    });
    setDetailLoading(false);
  }

  async function deleteJournal(id: number) {
    if (!confirm("이 작업일지를 삭제하시겠습니까?\n(연관된 작업내역·휴게·참가자도 함께 삭제됩니다)")) return;
    const { error } = await supabase.from("work_journals").delete().eq("id", id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
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
          ["mine", "내 작업일지"],
          ["all",  "전체"],
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
          <div className="text-5xl mb-3">📓</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">작성된 작업일지가 없습니다.</div>
        </div>
      ) : (
        records.map(r => {
          const opened = openId === r.id;
          const canEditDelete = r.user_id === user?.id || admin;
          const cats: string[] = [];
          if (r.category_inspection) cats.push("점검");
          if (r.category_fault)      cats.push("고장처리");
          if (r.category_repair)     cats.push("수리공사");

          return (
            <div key={r.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button type="button" onClick={() => loadDetail(r.id)}
                className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200">
                    {r.work_date}{r.weekday && ` (${r.weekday})`}
                  </span>
                  {cats.map(c => (
                    <span key={c} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                      {c}
                    </span>
                  ))}
                  <span className="text-[11px] text-gray-400 ml-auto">{r.user_name}</span>
                </div>
                <div className="text-sm font-bold text-gray-900 dark:text-white">
                  {r.site_name}
                  {r.elevator_unique_no && (
                    <span className="text-gray-500 dark:text-gray-400 font-normal ml-1">{r.elevator_unique_no}</span>
                  )}
                </div>
                {r.weather && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    날씨 {r.weather}
                    {r.temperature !== null && ` · 온도 ${r.temperature}℃`}
                    {r.humidity !== null && ` · 습도 ${r.humidity}%`}
                    {r.location && ` · 📍 ${r.location}`}
                  </div>
                )}
              </button>

              {opened && (
                <div className="border-t border-gray-100 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/50 space-y-3">
                  {detailLoading ? (
                    <div className="text-xs text-gray-500 text-center py-3">불러오는 중...</div>
                  ) : detail ? (
                    <>
                      <Section title="근무 시간">
                        <div className="text-xs text-gray-700 dark:text-gray-200 space-y-0.5">
                          <div>기본근무 {r.base_work_start?.slice(0,5)} ~ {r.base_work_end?.slice(0,5)}</div>
                          {(r.overtime_start || r.overtime_end) && (
                            <div>연장근무 {r.overtime_start?.slice(0,5) ?? "-"} ~ {r.overtime_end?.slice(0,5) ?? "-"}</div>
                          )}
                          {(r.overtime_hours > 0 || r.overtime_minutes > 0) && (
                            <div>연장시간 {r.overtime_hours}시간 {r.overtime_minutes}분</div>
                          )}
                        </div>
                      </Section>

                      {detail.envReadings.length > 0 && (
                        <Section title={`기상정보 (${detail.envReadings.length}건)`}>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px] border-collapse">
                              <thead>
                                <tr className="bg-white dark:bg-gray-800">
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">시각</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">온도(℃)</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">습도(%)</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">체감온도</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">지역정보</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.envReadings.map(x => {
                                  const info = heatStressLevel(x.apparent_temperature);
                                  return (
                                    <tr key={x.id} className="text-gray-700 dark:text-gray-200 text-center">
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

                      {detail.items.length > 0 && (
                        <Section title={`작업 내역 (${detail.items.length}건)`}>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px] border-collapse">
                              <thead>
                                <tr className="bg-white dark:bg-gray-800">
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">호기</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">구분</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">작업내용</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">작업시간</th>
                                  <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">조치결과</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.items.map(it => (
                                  <tr key={it.id} className="text-gray-700 dark:text-gray-200">
                                    <td className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">{it.unit_no}</td>
                                    <td className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">{it.work_category}</td>
                                    <td className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">{it.work_content}</td>
                                    <td className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">
                                      {(it.work_start || it.work_end)
                                        ? `${it.work_start?.slice(0,5) ?? "-"} ~ ${it.work_end?.slice(0,5) ?? "-"}`
                                        : "-"}
                                    </td>
                                    <td className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">{it.action_result}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </Section>
                      )}

                      {detail.rests.some(x => x.rest_start || x.rest_end || x.rest_method) && (
                        <Section title="온열질환 예방 휴게 실시">
                          <ul className="space-y-1">
                            {detail.rests
                              .filter(x => x.rest_start || x.rest_end || x.rest_method)
                              .map(x => (
                                <li key={x.id} className="text-xs text-gray-700 dark:text-gray-200">
                                  ✓ 휴게 {x.rest_start?.slice(0,5) ?? "-"} ~ {x.rest_end?.slice(0,5) ?? "-"}
                                  {x.rest_method && ` · ${x.rest_method}`}
                                </li>
                              ))}
                          </ul>
                        </Section>
                      )}

                      {r.special_notes && (
                        <Section title="특이사항">
                          <p className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{r.special_notes}</p>
                        </Section>
                      )}

                      {detail.participants.length > 0 && (
                        <Section title="참가자 서명">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {detail.participants
                              .filter(p => /^worker\d+$/.test(p.role))
                              .sort((a, b) => parseInt(a.role.slice(6), 10) - parseInt(b.role.slice(6), 10))
                              .map(p => {
                                const idx = parseInt(p.role.slice(6), 10);
                                const isMe = user && p.user_id === user.id;
                                const missing = !p.signature_url;
                                return (
                                  <div key={p.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">
                                      작업자 {idx}
                                    </div>
                                    <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">
                                      {p.name || "-"}
                                    </div>
                                    {p.signature_url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={p.signature_url} alt="" className="mt-1 h-14 bg-white rounded border border-gray-200" />
                                    ) : (
                                      <div className="mt-1 h-14 flex items-center justify-center rounded border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                        서명 대기
                                      </div>
                                    )}
                                    {missing && isMe && (
                                      <button
                                        type="button"
                                        onClick={() => setSigning({ participantId: p.id, name: p.name || "", journalId: r.id })}
                                        className="mt-1.5 w-full py-1 rounded text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700"
                                      >
                                        ✍️ 내 서명 추가
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </Section>
                      )}

                      {canEditDelete && (
                        <div className="flex gap-2">
                          {onEdit && (
                            <button type="button" onClick={() => onEdit(r.id)}
                              className="flex-1 py-2 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                              ✏️ 수정
                            </button>
                          )}
                          <button type="button" onClick={() => deleteJournal(r.id)}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20">
                            🗑️ 삭제
                          </button>
                        </div>
                      )}
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

      {signing && (
        <WorkJournalAddSignatureModal
          participantId={signing.participantId}
          participantName={signing.name}
          journalId={signing.journalId}
          onClose={() => setSigning(null)}
          onSaved={() => {
            const id = openId;
            setSigning(null);
            // 상세 다시 로드
            if (id) {
              (async () => {
                const [it, hr, en, pt] = await Promise.all([
                  supabase.from("work_journal_items").select("*").eq("journal_id", id).order("seq"),
                  supabase.from("work_journal_heat_rests").select("*").eq("journal_id", id).order("seq"),
                  supabase.from("work_journal_env_readings").select("*").eq("journal_id", id).order("seq"),
                  supabase.from("work_journal_participants").select("*").eq("journal_id", id),
                ]);
                setDetail({
                  items: (it.data ?? []) as JournalItem[],
                  rests: (hr.data ?? []) as HeatRest[],
                  envReadings: (en.data ?? []) as EnvReading[],
                  participants: (pt.data ?? []) as Participant[],
                });
              })();
            }
          }}
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
