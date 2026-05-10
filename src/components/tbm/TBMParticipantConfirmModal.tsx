"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  TBMRecord, TBMRecordSafetyRule, TBMChecklistResult,
  TBMParticipantChecklist, TBMParticipantSafety, TBMParticipantPhoto,
  MODE_LABELS, SUB_TYPE_LABELS,
} from "@/lib/tbm";
import SignaturePad, { SignaturePadHandle } from "./SignaturePad";
import { useBackdropClose } from "@/lib/useBackdropClose";

interface Props {
  record: TBMRecord;
  onClose: () => void;
  onSaved: () => void;
}

const STORAGE_BUCKET = "tbm-photos";

export default function TBMParticipantConfirmModal({ record, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const backdrop = useBackdropClose(onClose);

  const [checklist, setChecklist] = useState<TBMChecklistResult[]>([]);
  const [rules, setRules] = useState<TBMRecordSafetyRule[]>([]);

  const [myChecks, setMyChecks] = useState<Set<number>>(new Set());
  const [myAcks, setMyAcks] = useState<Set<number>>(new Set());
  const [mySigUrl, setMySigUrl] = useState<string | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [myPhotos, setMyPhotos] = useState<TBMParticipantPhoto[]>([]);

  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [newPhotoPreviews, setNewPhotoPreviews] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sigPadRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [c, r, mc, ms, mp, me] = await Promise.all([
        supabase.from("tbm_checklist_results").select("*").eq("tbm_id", record.id),
        supabase.from("tbm_record_safety_rules").select("*").eq("tbm_id", record.id),
        supabase.from("tbm_participant_checklist").select("*").eq("tbm_id", record.id).eq("user_id", user.id),
        supabase.from("tbm_participant_safety").select("*").eq("tbm_id", record.id).eq("user_id", user.id),
        supabase.from("tbm_participant_photos").select("*").eq("tbm_id", record.id).eq("user_id", user.id).order("uploaded_at"),
        supabase.from("tbm_participants").select("signature_url, confirmed_at").eq("tbm_id", record.id).eq("user_id", user.id).single(),
      ]);
      const cl = (c.data ?? []) as TBMChecklistResult[];
      const rl = (r.data ?? []) as TBMRecordSafetyRule[];
      setChecklist(cl);
      setRules(rl);
      setMyChecks(new Set(((mc.data ?? []) as TBMParticipantChecklist[]).filter(x => x.is_checked).map(x => x.item_id)));
      setMyAcks(new Set(((ms.data ?? []) as TBMParticipantSafety[]).filter(x => x.acknowledged).map(x => x.rule_id)));
      setMyPhotos((mp.data ?? []) as TBMParticipantPhoto[]);
      const meRow = me.data as { signature_url: string | null; confirmed_at: string | null } | null;
      if (meRow) {
        setMySigUrl(meRow.signature_url);
        setConfirmedAt(meRow.confirmed_at);
      }
      setLoading(false);
    })();
  }, [record.id, user]);

  function toggleSet<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setNewPhotos(prev => [...prev, ...files]);
    files.forEach(f => {
      const reader = new FileReader();
      reader.onload = ev => setNewPhotoPreviews(prev => [...prev, ev.target?.result as string]);
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  }

  function removeNewPhoto(idx: number) {
    setNewPhotos(prev => prev.filter((_, i) => i !== idx));
    setNewPhotoPreviews(prev => prev.filter((_, i) => i !== idx));
  }

  async function deleteExistingPhoto(id: number) {
    if (!confirm("이 사진을 삭제하시겠습니까?")) return;
    const { error: err } = await supabase.from("tbm_participant_photos").delete().eq("id", id);
    if (err) { alert(err.message); return; }
    setMyPhotos(prev => prev.filter(p => p.id !== id));
  }

  async function uploadFile(file: Blob, ext: string): Promise<string> {
    const path = `${user!.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSubmit() {
    if (!user) return;
    setError("");

    const allChecked = checklist.every(c => myChecks.has(c.item_id));
    const allAcked = rules.every(r => myAcks.has(r.rule_id));
    if (!allChecked || !allAcked) {
      if (!confirm("모든 체크리스트·안전수칙을 확인하지 않았습니다. 그래도 저장하시겠습니까?")) return;
    }

    setSaving(true);
    try {
      // 1. 새 서명 (있으면)
      let sigUrl = mySigUrl;
      const newSigDataUrl = sigPadRef.current?.getDataURL();
      const sigEmpty = sigPadRef.current?.isEmpty();
      if (newSigDataUrl && !sigEmpty) {
        const blob = await (await fetch(newSigDataUrl)).blob();
        sigUrl = await uploadFile(blob, "png");
      }

      // 2. 새 사진 업로드
      const photoUrls: string[] = [];
      for (const f of newPhotos) {
        const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
        photoUrls.push(await uploadFile(f, ext));
      }

      // 3. 참가자 행 업데이트 (signature_url + confirmed_at)
      const { error: pErr } = await supabase.from("tbm_participants").update({
        signature_url: sigUrl,
        confirmed_at: new Date().toISOString(),
      }).eq("tbm_id", record.id).eq("user_id", user.id);
      if (pErr) throw pErr;

      // 4. 체크리스트 응답 upsert
      if (checklist.length > 0) {
        const { error: cErr } = await supabase.from("tbm_participant_checklist").upsert(
          checklist.map(c => ({
            tbm_id: record.id, user_id: user.id, item_id: c.item_id,
            is_checked: myChecks.has(c.item_id),
          })),
          { onConflict: "tbm_id,user_id,item_id" }
        );
        if (cErr) throw cErr;
      }

      // 5. 안전수칙 확인 upsert
      if (rules.length > 0) {
        const { error: sErr } = await supabase.from("tbm_participant_safety").upsert(
          rules.map(r => ({
            tbm_id: record.id, user_id: user.id, rule_id: r.rule_id,
            acknowledged: myAcks.has(r.rule_id),
          })),
          { onConflict: "tbm_id,user_id,rule_id" }
        );
        if (sErr) throw sErr;
      }

      // 6. 사진 insert
      if (photoUrls.length > 0) {
        const { error: phErr } = await supabase.from("tbm_participant_photos").insert(
          photoUrls.map(url => ({ tbm_id: record.id, user_id: user.id, photo_url: url }))
        );
        if (phErr) throw phErr;
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" {...backdrop}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[95vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-gray-900 dark:text-white">참가자 확인</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {record.user_name} 작성 · {record.site_name} {record.elevator_name}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-gray-500">로딩 중...</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* 작성자가 작성한 내용 요약 */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  record.mode === "repair"
                    ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"
                    : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                }`}>
                  {MODE_LABELS[record.mode]}{record.sub_type ? ` · ${SUB_TYPE_LABELS[record.sub_type]}` : ""}
                </span>
                {confirmedAt && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                    ✓ 확인 완료
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{record.work_content}</div>
              {record.risk_assessment && (
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                  <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">위험요소</div>
                  <div className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{record.risk_assessment}</div>
                </div>
              )}
            </div>

            {/* 체크리스트 확인 */}
            {checklist.length > 0 && (
              <div>
                <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
                  ✅ 체크리스트 확인 ({myChecks.size}/{checklist.length})
                </div>
                <div className="space-y-1.5">
                  {checklist.map(c => {
                    const checked = myChecks.has(c.item_id);
                    return (
                      <label key={c.item_id}
                        className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                          checked
                            ? "border-green-400 bg-green-50 dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30"
                        }`}>
                        <input type="checkbox" checked={checked}
                          onChange={() => setMyChecks(s => toggleSet(s, c.item_id))}
                          className="sr-only" />
                        <span className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs font-bold ${
                          checked ? "bg-green-500 border-green-500 text-white" : "border-gray-400"
                        }`}>{checked && "✓"}</span>
                        <span className="text-xs text-gray-700 dark:text-gray-200">{c.item_label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 안전수칙 확인 */}
            {rules.length > 0 && (
              <div>
                <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
                  ⚠️ 안전수칙 확인 ({myAcks.size}/{rules.length})
                </div>
                <div className="space-y-1.5">
                  {rules.map(r => {
                    const acked = myAcks.has(r.rule_id);
                    return (
                      <label key={r.rule_id}
                        className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${
                          acked
                            ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
                            : "border-gray-200 dark:border-gray-600"
                        }`}>
                        <input type="checkbox" checked={acked}
                          onChange={() => setMyAcks(s => toggleSet(s, r.rule_id))}
                          className="mt-0.5" />
                        <div className="flex-1 text-xs text-gray-700 dark:text-gray-200">{r.rule_text}</div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 사진 */}
            <div>
              <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
                📷 내 사진 ({myPhotos.length + newPhotos.length}장)
              </div>
              <label className="block w-full py-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-center cursor-pointer hover:border-blue-400 mb-2">
                <input type="file" accept="image/*" multiple capture="environment" onChange={onPhotoChange} className="hidden" />
                <div className="text-2xl mb-1">📸</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">탭하여 사진 추가</div>
              </label>
              {(myPhotos.length > 0 || newPhotoPreviews.length > 0) && (
                <div className="grid grid-cols-3 gap-2">
                  {myPhotos.map(p => (
                    <div key={p.id} className="relative aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.photo_url} alt="" className="w-full h-full object-cover rounded-lg" />
                      <button type="button" onClick={() => deleteExistingPhoto(p.id)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold">×</button>
                    </div>
                  ))}
                  {newPhotoPreviews.map((src, i) => (
                    <div key={`new-${i}`} className="relative aspect-square ring-2 ring-blue-400 rounded-lg">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="w-full h-full object-cover rounded-lg" />
                      <button type="button" onClick={() => removeNewPhoto(i)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 서명 */}
            <div>
              <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
                ✍️ 내 서명 ({user?.name})
              </div>
              {mySigUrl && (
                <div className="mb-2">
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">기존 서명 (다시 서명하면 교체됨)</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mySigUrl} alt="기존 서명" className="h-16 bg-white rounded border border-gray-200" />
                </div>
              )}
              <SignaturePad ref={sigPadRef} />
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
          <button type="button" onClick={handleSubmit} disabled={saving || loading}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중..." : confirmedAt ? "재확인 저장" : "확인 완료"}
          </button>
        </div>
      </div>
    </div>
  );
}

