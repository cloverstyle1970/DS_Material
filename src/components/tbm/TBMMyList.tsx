"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  TBMRecord, TBMParticipant, TBMRecordSafetyRule, TBMChecklistResult, TBMPhoto,
  MODE_LABELS, SUB_TYPE_LABELS,
} from "@/lib/tbm";

interface DetailData {
  participants: TBMParticipant[];
  rules: TBMRecordSafetyRule[];
  checklist: TBMChecklistResult[];
  photos: TBMPhoto[];
}

export default function TBMMyList() {
  const { user } = useAuth();
  const [records, setRecords] = useState<TBMRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("tbm_records")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setRecords((data ?? []) as TBMRecord[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [user]);

  async function loadDetail(id: number) {
    if (openId === id) {
      setOpenId(null); setDetail(null); return;
    }
    setOpenId(id); setDetailLoading(true); setDetail(null);
    const [p, r, c, ph] = await Promise.all([
      supabase.from("tbm_participants").select("*").eq("tbm_id", id),
      supabase.from("tbm_record_safety_rules").select("*").eq("tbm_id", id),
      supabase.from("tbm_checklist_results").select("*").eq("tbm_id", id),
      supabase.from("tbm_photos").select("*").eq("tbm_id", id).order("uploaded_at"),
    ]);
    setDetail({
      participants: (p.data ?? []) as TBMParticipant[],
      rules: (r.data ?? []) as TBMRecordSafetyRule[],
      checklist: (c.data ?? []) as TBMChecklistResult[],
      photos: (ph.data ?? []) as TBMPhoto[],
    });
    setDetailLoading(false);
  }

  async function deleteTbm(id: number) {
    if (!confirm("이 TBM 기록을 삭제하시겠습니까?\n(연관된 참가자/사진/안전수칙/체크리스트도 함께 삭제됩니다)")) return;
    const { error } = await supabase.from("tbm_records").delete().eq("id", id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    if (openId === id) { setOpenId(null); setDetail(null); }
    load();
  }

  if (loading) return <div className="p-6 text-center text-sm text-gray-500">로딩 중...</div>;
  if (records.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">📋</div>
        <div className="text-sm text-gray-500 dark:text-gray-400">아직 작성한 TBM이 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {records.map(r => {
        const opened = openId === r.id;
        const dt = new Date(r.created_at);
        const dtStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")} ${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`;
        const modeColor = r.mode === "repair" ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300" : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300";

        return (
          <div key={r.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              type="button"
              onClick={() => loadDetail(r.id)}
              className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${modeColor}`}>
                  {MODE_LABELS[r.mode]}{r.sub_type ? ` · ${SUB_TYPE_LABELS[r.sub_type]}` : ""}
                </span>
                <span className="text-[11px] text-gray-400 ml-auto">{dtStr}</span>
              </div>
              <div className="text-sm font-bold text-gray-900 dark:text-white">
                {r.site_name} {r.elevator_name && <span className="text-gray-500 dark:text-gray-400 font-normal">{r.elevator_name}</span>}
              </div>
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
                            <span key={p.user_id} className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                              {p.user_name}
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
                      <Section title="서명">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.signature_url} alt="서명" className="h-20 bg-white rounded border border-gray-200" />
                      </Section>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteTbm(r.id)}
                      className="w-full py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      🗑️ 이 TBM 삭제
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
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
