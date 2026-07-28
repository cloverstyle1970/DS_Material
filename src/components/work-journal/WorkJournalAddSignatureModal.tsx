"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { heatStressLevel } from "@/lib/apparent-temperature";
import SignaturePad, { SignaturePadHandle } from "../tbm/SignaturePad";
import DraggableModal from "@/components/common/DraggableModal";

interface Props {
  participantId: number;
  participantName: string;
  journalId: number;
  onClose: () => void;
  onSaved: () => void;
}

interface Journal {
  id: number;
  user_name: string;
  work_date: string;
  weekday: string | null;
  weather: string | null;
  site_name: string;
  elevator_unique_no: string;
  temperature: number | null;
  humidity: number | null;
  apparent_temperature: number | null;
  location: string | null;
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
}

interface Item {
  id: number; seq: number;
  unit_no: string; work_category: string;
  work_content: string; work_start: string | null; work_end: string | null; action_result: string;
}

interface HeatRest {
  id: number; seq: number;
  rest_start: string | null; rest_end: string | null;
  rest_method: string | null;
}

interface EnvReading {
  id: number; seq: number;
  observed_at: string | null;
  temperature: number | null;
  humidity: number | null;
  apparent_temperature: number | null;
  location: string | null;
}

const STORAGE_BUCKET = "tbm-photos";

export default function WorkJournalAddSignatureModal({
  participantId, participantName, journalId, onClose, onSaved,
}: Props) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sigPadRef = useRef<SignaturePadHandle>(null);

  const [journal, setJournal] = useState<Journal | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [rests, setRests] = useState<HeatRest[]>([]);
  const [envs, setEnvs] = useState<EnvReading[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [j, it, hr, en] = await Promise.all([
        supabase.from("work_journals").select("*").eq("id", journalId).single(),
        supabase.from("work_journal_items").select("*").eq("journal_id", journalId).order("seq"),
        supabase.from("work_journal_heat_rests").select("*").eq("journal_id", journalId).order("seq"),
        supabase.from("work_journal_env_readings").select("*").eq("journal_id", journalId).order("seq"),
      ]);
      if (j.data) setJournal(j.data as Journal);
      setItems((it.data ?? []) as Item[]);
      setRests((hr.data ?? []) as HeatRest[]);
      setEnvs((en.data ?? []) as EnvReading[]);
      setLoading(false);
    })();
  }, [journalId]);

  async function uploadSignature(): Promise<string> {
    const pad = sigPadRef.current;
    if (!pad || pad.isEmpty()) throw new Error("서명을 입력하세요.");
    const dataUrl = pad.getDataURL();
    if (!dataUrl) throw new Error("서명 데이터를 읽을 수 없습니다.");
    const blob = await (await fetch(dataUrl)).blob();
    const path = `work-journal/${user!.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, {
      cacheControl: "3600", upsert: false,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSave() {
    if (!user) return;
    setError("");
    setSaving(true);
    try {
      const url = await uploadSignature();
      const { error: updErr } = await supabase.from("work_journal_participants")
        .update({ signature_url: url })
        .eq("id", participantId);
      if (updErr) throw updErr;
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const cats: string[] = [];
  if (journal?.category_inspection) cats.push("점검");
  if (journal?.category_fault)      cats.push("고장처리");
  if (journal?.category_repair)     cats.push("수리공사");

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-lg max-h-[95vh]"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-gray-900 dark:text-white">작업일지 확인 후 서명</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {participantName} · 작업일지 #{journalId}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
      {loading ? (
        <div className="p-12 text-center text-sm text-gray-500">불러오는 중...</div>
      ) : !journal ? (
        <div className="p-12 text-center text-sm text-red-500">작업일지를 찾을 수 없습니다.</div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* 기본 정보 */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-1">
            <div className="text-xs font-bold text-gray-800 dark:text-gray-100">
              {journal.work_date}{journal.weekday && ` (${journal.weekday})`}
              {journal.weather && <span className="ml-2 text-gray-500 dark:text-gray-400 font-normal">· {journal.weather}</span>}
            </div>
            <div className="text-sm font-bold text-gray-900 dark:text-white">
              {journal.site_name}
              {journal.elevator_unique_no && (
                <span className="ml-1 text-gray-500 dark:text-gray-400 font-normal">{journal.elevator_unique_no}</span>
              )}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">작성: {journal.user_name}</div>
          </div>

          {/* 작업구분 */}
          {cats.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {cats.map(c => (
                <span key={c} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                  {c}
                </span>
              ))}
            </div>
          )}

          {/* 환경 지표 */}
          {(journal.temperature !== null || journal.humidity !== null || journal.apparent_temperature !== null) && (
            <Section title="환경 지표">
              {(() => {
                const info = heatStressLevel(journal.apparent_temperature);
                return (
                  <div className="text-xs text-gray-700 dark:text-gray-200 flex flex-wrap gap-1.5 items-center">
                    {journal.temperature !== null && <span>온도 {journal.temperature}℃</span>}
                    {journal.humidity !== null && <span>· 습도 {journal.humidity}%</span>}
                    {journal.apparent_temperature !== null && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${info?.colorClass ?? "border-gray-300"}`}>
                        체감 {journal.apparent_temperature}℃
                        {info && <span>· {info.label}</span>}
                      </span>
                    )}
                    {journal.location && <span className="text-[11px]">· 📍 {journal.location}</span>}
                  </div>
                );
              })()}
            </Section>
          )}

          {/* 근무 시간 */}
          <Section title="근무 시간">
            <div className="text-xs text-gray-700 dark:text-gray-200 space-y-0.5">
              <div>기본근무 {journal.base_work_start?.slice(0,5) ?? "-"} ~ {journal.base_work_end?.slice(0,5) ?? "-"}</div>
              {(journal.overtime_start || journal.overtime_end) && (
                <div>연장근무 {journal.overtime_start?.slice(0,5) ?? "-"} ~ {journal.overtime_end?.slice(0,5) ?? "-"}</div>
              )}
              {(journal.overtime_hours > 0 || journal.overtime_minutes > 0) && (
                <div>연장시간 {journal.overtime_hours}시간 {journal.overtime_minutes}분</div>
              )}
            </div>
          </Section>

          {/* 작업 내역 */}
          {items.length > 0 && (
            <Section title={`작업 내역 (${items.length}건)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse text-center">
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
                    {items.map(it => (
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

          {/* 온열질환 휴게 실시 */}
          {rests.some(x => x.rest_start || x.rest_end || x.rest_method) && (
            <Section title="온열질환 예방 휴게 실시">
              <ul className="space-y-1">
                {rests
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

          {/* 기상정보 로그 */}
          {envs.length > 0 && (
            <Section title={`기상정보 (${envs.length}건)`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] border-collapse text-center">
                  <thead>
                    <tr className="bg-white dark:bg-gray-800">
                      <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">시각</th>
                      <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">온도</th>
                      <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">습도</th>
                      <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">체감온도</th>
                      <th className="border border-gray-200 dark:border-gray-700 px-1.5 py-1">지역</th>
                    </tr>
                  </thead>
                  <tbody>
                    {envs.map(x => {
                      const info = heatStressLevel(x.apparent_temperature);
                      return (
                        <tr key={x.id} className="text-gray-700 dark:text-gray-200">
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

          {/* 특이사항 */}
          {journal.special_notes && (
            <Section title="특이사항">
              <p className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{journal.special_notes}</p>
            </Section>
          )}

          {/* 서명 */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              ✍️ 내 서명 <span className="text-red-500">*</span>
            </label>
            <SignaturePad ref={sigPadRef} />
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              위 내용을 확인한 뒤 서명하고 저장 버튼을 누르세요.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-xs px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>
      )}
      <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
          취소
        </button>
        <button type="button" onClick={handleSave} disabled={saving || loading}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "저장 중..." : "서명 저장"}
        </button>
      </div>
    </DraggableModal>
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
