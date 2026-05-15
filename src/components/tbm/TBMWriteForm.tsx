"use client";

import { useState, useEffect, useRef, FormEvent, KeyboardEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  TBMMode, TBMSubType, SafetyRule, RepairType, FaultType, ChecklistItem,
  SafetyCategory,
  MODE_LABELS, SUB_TYPE_LABELS, SUB_TYPE_ICONS, CATEGORY_LABELS, SEASON_LABELS,
} from "@/lib/tbm";
import SignaturePad, { SignaturePadHandle } from "./SignaturePad";
import Combobox, { ComboboxHandle } from "./Combobox";

interface Site { id: number; name: string }
interface Elevator { id: number; site_name: string; unit_name: string }
interface UserMini { id: number; name: string; dept: string }
interface Schedule {
  id: number; site_name: string; elevator_name: string;
  start_date: string; end_date: string; details: string;
}

const STORAGE_BUCKET = "tbm-photos";

export default function TBMWriteForm({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();

  // ------- 마스터 데이터 -------
  const [safetyRules, setSafetyRules] = useState<SafetyRule[]>([]);
  const [repairTypes, setRepairTypes] = useState<RepairType[]>([]);
  const [faultTypes, setFaultTypes] = useState<FaultType[]>([]);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [elevators, setElevators] = useState<Elevator[]>([]);
  const [users, setUsers] = useState<UserMini[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  // ------- 폼 상태 -------
  const [mode, setMode] = useState<TBMMode>("repair");
  const [subType, setSubType] = useState<TBMSubType>("inspect");
  const [siteName, setSiteName] = useState("");
  const [elevatorName, setElevatorName] = useState("");
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [repairTypeId, setRepairTypeId] = useState<number | "">("");
  const [faultTypeId, setFaultTypeId] = useState<number | "">("");
  const [partsName, setPartsName] = useState("");
  const [passengerTrapped, setPassengerTrapped] = useState(false);
  const [workContent, setWorkContent] = useState("");
  const [riskAssessment, setRiskAssessment] = useState("");
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());
  const [selectedRules, setSelectedRules] = useState<Set<number>>(new Set());
  const [participants, setParticipants] = useState<UserMini[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [participantSearch, setParticipantSearch] = useState("");
  const [ruleCategory, setRuleCategory] = useState<SafetyCategory>("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sigPadRef = useRef<SignaturePadHandle>(null);
  // 키보드 네비게이션용 refs
  const elevatorRef = useRef<ComboboxHandle>(null);
  const workContentRef = useRef<HTMLTextAreaElement>(null);
  const elevatorInputRef = useRef<HTMLInputElement>(null);
  const participantSearchRef = useRef<HTMLInputElement>(null);
  const [participantHighlighted, setParticipantHighlighted] = useState(0);

  // ------- 마스터 로드 -------
  useEffect(() => {
    (async () => {
      const [sr, rt, ft, ci, st, ev, us] = await Promise.all([
        supabase.from("tbm_safety_rules_master").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("tbm_repair_types").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("tbm_fault_types").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("tbm_checklist_items").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("sites").select("id, name").order("name"),
        supabase.from("elevators").select("id, site_name, unit_name").order("unit_name"),
        supabase.from("users").select("id, name, dept").eq("status", "재직").order("name"),
      ]);
      if (sr.data) setSafetyRules(sr.data as SafetyRule[]);
      if (rt.data) setRepairTypes(rt.data as RepairType[]);
      if (ft.data) setFaultTypes(ft.data as FaultType[]);
      if (ci.data) setChecklistItems(ci.data as ChecklistItem[]);
      if (st.data) setSites(st.data as Site[]);
      if (ev.data) setElevators(ev.data as Elevator[]);
      if (us.data) setUsers(us.data as UserMini[]);
    })();
  }, []);

  // ------- 공사일정 로드 (오늘±30일, TBM 미작성 + 공사휴무 제외) -------
  useEffect(() => {
    (async () => {
      const today = new Date();
      const start = new Date(today); start.setDate(today.getDate() - 30);
      const end = new Date(today); end.setDate(today.getDate() + 30);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      // 이미 TBM이 작성된 schedule_id 집합
      const { data: tbmRows } = await supabase.from("tbm_records")
        .select("schedule_id")
        .not("schedule_id", "is", null);
      const usedIds = new Set(((tbmRows ?? []) as { schedule_id: number }[]).map(r => r.schedule_id));

      const { data } = await supabase.from("construction_schedules")
        .select("id, site_name, elevator_name, start_date, end_date, details, company_type")
        .gte("end_date", fmt(start))
        .lte("start_date", fmt(end))
        .neq("site_name", "공사휴무")  // 공사휴무 제외
        .or("company_type.is.null,company_type.neq.TK")  // TK 현장 제외 (TBM 대상 아님)
        .order("start_date", { ascending: false });
      // TBM이 이미 작성된 일정 제외
      const filtered = ((data ?? []) as Schedule[]).filter(s => !usedIds.has(s.id));
      setSchedules(filtered);
    })();
  }, []);

  // ------- 모드/서브타입 변경 시 무관한 필드 초기화 -------
  useEffect(() => {
    if (mode === "repair") {
      setFaultTypeId(""); setPartsName(""); setPassengerTrapped(false);
    } else {
      setRepairTypeId("");
    }
    setCheckedItems(new Set());
  }, [mode]);

  useEffect(() => {
    if (subType !== "fault") { setFaultTypeId(""); setPassengerTrapped(false); }
    if (subType !== "parts") setPartsName("");
  }, [subType]);

  // ------- 파생값 -------
  const checklistType = mode === "repair" ? "repair" : (subType === "inspect" ? "inspect" : null);
  const visibleChecklist = checklistType
    ? checklistItems.filter(i => i.list_type === checklistType)
    : [];

  const visibleElevators = elevators.filter(e => e.site_name === siteName);

  const filteredRules = safetyRules.filter(r => {
    if (ruleCategory === "all") return true;
    return r.category === ruleCategory || r.category === "all";
  });

  const filteredParticipants = participantSearch.trim()
    ? users.filter(u =>
        u.id !== user?.id &&
        !participants.some(p => p.id === u.id) &&
        (u.name.includes(participantSearch.trim()) || u.dept.includes(participantSearch.trim()))
      ).slice(0, 8)
    : [];

  // ------- 핸들러 -------
  function toggleSet<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  }

  function pickSchedule(sid: number) {
    const s = schedules.find(x => x.id === sid);
    if (!s) { setScheduleId(null); return; }
    setScheduleId(sid);
    setSiteName(s.site_name);
    setElevatorName(s.elevator_name);
    if (s.details) setWorkContent(s.details); // 공사일정 선택 시 작업내용 자동 채움
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setPhotos(prev => [...prev, ...files]);
    files.forEach(f => {
      const reader = new FileReader();
      reader.onload = ev => setPhotoPreviews(prev => [...prev, ev.target?.result as string]);
      reader.readAsDataURL(f);
    });
    e.target.value = "";
  }

  function removePhoto(idx: number) {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== idx));
  }

  async function uploadFile(file: Blob, ext: string): Promise<string> {
    const path = `${user!.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
      cacheControl: "3600", upsert: false,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function uploadSignature(): Promise<string | null> {
    const dataUrl = sigPadRef.current?.getDataURL();
    if (!dataUrl || sigPadRef.current?.isEmpty()) return null;
    const blob = await (await fetch(dataUrl)).blob();
    return await uploadFile(blob, "png");
  }

  async function uploadPhotos(): Promise<string[]> {
    const urls: string[] = [];
    for (const f of photos) {
      const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
      urls.push(await uploadFile(f, ext));
    }
    return urls;
  }

  function resetForm() {
    setSiteName(""); setElevatorName(""); setScheduleId(null);
    setRepairTypeId(""); setFaultTypeId(""); setPartsName(""); setPassengerTrapped(false);
    setWorkContent(""); setRiskAssessment("");
    setCheckedItems(new Set()); setSelectedRules(new Set());
    setParticipants([]); setPhotos([]); setPhotoPreviews([]);
    setParticipantSearch("");
    sigPadRef.current?.clear();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError("");

    // 검증
    if (!siteName.trim()) { setError("현장명을 입력하세요."); return; }
    if (!workContent.trim()) { setError("작업 내용을 입력하세요."); return; }
    if (mode === "repair" && !repairTypeId) { setError("공사구분을 선택하세요."); return; }
    if (subType === "fault" && !faultTypeId) { setError("고장 증상을 선택하세요."); return; }
    if (subType === "parts" && !partsName.trim()) { setError("교체 부품명을 입력하세요."); return; }

    setSaving(true);
    try {
      // 1. 사진/서명 업로드
      const [sigUrl, photoUrls] = await Promise.all([uploadSignature(), uploadPhotos()]);

      // 2. tbm_records insert
      const { data: rec, error: recErr } = await supabase.from("tbm_records").insert({
        user_id: user.id,
        user_name: user.name,
        mode,
        sub_type: mode === "maintain" ? subType : null,
        site_name: siteName.trim(),
        elevator_name: elevatorName.trim(),
        schedule_id: scheduleId,
        repair_type_id: mode === "repair" ? (repairTypeId || null) : null,
        fault_type_id: subType === "fault" ? (faultTypeId || null) : null,
        parts_name: subType === "parts" ? partsName.trim() : "",
        passenger_trapped: subType === "fault" ? passengerTrapped : false,
        work_content: workContent.trim(),
        risk_assessment: riskAssessment.trim(),
        signature_url: sigUrl,
      }).select("id").single();
      if (recErr) throw recErr;
      const tbmId = rec.id as number;

      // 3. 부속 데이터 일괄 insert (supabase 빌더는 thenable이므로 PromiseLike로 처리)
      const tasks: Array<PromiseLike<{ error: { message: string } | null }>> = [];

      if (participants.length > 0) {
        tasks.push(supabase.from("tbm_participants").insert(
          participants.map(p => ({ tbm_id: tbmId, user_id: p.id, user_name: p.name }))
        ));
      }

      if (selectedRules.size > 0) {
        tasks.push(supabase.from("tbm_record_safety_rules").insert(
          [...selectedRules].map(rid => {
            const r = safetyRules.find(x => x.id === rid)!;
            return { tbm_id: tbmId, rule_id: rid, rule_text: r.text };
          })
        ));
      }

      if (visibleChecklist.length > 0) {
        tasks.push(supabase.from("tbm_checklist_results").insert(
          visibleChecklist.map(item => ({
            tbm_id: tbmId, item_id: item.id, item_label: item.label,
            is_checked: checkedItems.has(item.id),
          }))
        ));
      }

      if (photoUrls.length > 0) {
        tasks.push(supabase.from("tbm_photos").insert(
          photoUrls.map(url => ({ tbm_id: tbmId, photo_url: url }))
        ));
      }

      const results = await Promise.all(tasks);
      const insertErr = results.find(r => r.error);
      if (insertErr?.error) throw new Error(insertErr.error.message);

      resetForm();
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`저장 실패: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  // ============================================================
  // 렌더
  // ============================================================

  const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-500";
  const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5";
  const sectionCls = "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-3";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* 모드 전환 */}
      <div className={sectionCls}>
        <label className={labelCls}>업무 구분</label>
        <div className="grid grid-cols-2 gap-2">
          {(["repair", "maintain"] as TBMMode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`py-3 rounded-lg border-2 text-sm font-bold transition-all ${
                mode === m
                  ? (m === "repair"
                      ? "border-orange-500 bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                      : "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300")
                  : "border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400"
              }`}
            >
              {m === "repair" ? "🛠️" : "🔧"} {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {/* 보수 서브타입 */}
        {mode === "maintain" && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {(["inspect", "parts", "fault"] as TBMSubType[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSubType(s)}
                className={`py-2.5 rounded-lg border-2 text-xs font-semibold transition-all ${
                  subType === s
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                    : "border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400"
                }`}
              >
                {SUB_TYPE_ICONS[s]} {SUB_TYPE_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 현장 정보 */}
      <div className={sectionCls}>
        <label className={labelCls}>📍 현장 정보</label>

        <div className="mb-3">
          <select
            value={scheduleId ?? ""}
            onChange={e => pickSchedule(Number(e.target.value))}
            className={inputCls}
          >
            <option value="">
              {schedules.length > 0
                ? "— 공사일정에서 가져오기 (선택) —"
                : "— 공사일정 없음 (직접 입력) —"}
            </option>
            {schedules.map(s => (
              <option key={s.id} value={s.id}>
                [{s.start_date}~{s.end_date}] {s.site_name} {s.elevator_name}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-2">
          <Combobox<Site>
            value={siteName}
            onChange={v => { setSiteName(v); setScheduleId(null); }}
            options={sites}
            getLabel={s => s.name}
            onSelect={() => setElevatorName("")}
            nextRef={elevatorRef as unknown as React.RefObject<{ focus: () => void }>}
            placeholder="현장명 * (입력 후 ↓·↑·Enter)"
            className={inputCls}
          />
        </div>

        {visibleElevators.length > 0 ? (
          <Combobox<Elevator>
            ref={elevatorRef}
            value={elevatorName}
            onChange={setElevatorName}
            options={visibleElevators}
            getLabel={e => e.unit_name}
            nextRef={workContentRef}
            placeholder="호기 선택 (등록된 호기에서 선택)"
            className={inputCls}
          />
        ) : (
          <input
            ref={elevatorInputRef}
            type="text"
            value={elevatorName}
            onChange={e => setElevatorName(e.target.value)}
            onKeyDown={e => {
              if ((e.nativeEvent as KeyboardEvent["nativeEvent"] & { isComposing?: boolean }).isComposing) return;
              if (e.key === "Enter") { e.preventDefault(); workContentRef.current?.focus(); }
            }}
            placeholder="호기 (예: 1호기, 생략 가능)"
            lang="ko"
            className={inputCls}
          />
        )}
      </div>

      {/* 공사구분 (수리) */}
      {mode === "repair" && (
        <div className={sectionCls}>
          <label className={labelCls}>공사구분 <span className="text-red-500">*</span></label>
          <select
            value={repairTypeId}
            onChange={e => setRepairTypeId(e.target.value ? Number(e.target.value) : "")}
            className={inputCls}
          >
            <option value="">선택하세요</option>
            {repairTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
          </select>
        </div>
      )}

      {/* 고장처리 추가 */}
      {subType === "fault" && (
        <div className={sectionCls}>
          <label className={labelCls}>고장 증상 <span className="text-red-500">*</span></label>
          <select
            value={faultTypeId}
            onChange={e => setFaultTypeId(e.target.value ? Number(e.target.value) : "")}
            className={inputCls + " mb-3"}
          >
            <option value="">선택하세요</option>
            {faultTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.label}</option>)}
          </select>
          <label className={labelCls}>승객 갇힘 여부</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPassengerTrapped(false)}
              className={`py-2.5 rounded-lg border-2 text-sm font-semibold ${
                !passengerTrapped
                  ? "border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                  : "border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400"
              }`}
            >🟢 갇힘 없음</button>
            <button
              type="button"
              onClick={() => setPassengerTrapped(true)}
              className={`py-2.5 rounded-lg border-2 text-sm font-semibold ${
                passengerTrapped
                  ? "border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                  : "border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400"
              }`}
            >🔴 승객 갇힘</button>
          </div>
        </div>
      )}

      {/* 부품교체 */}
      {subType === "parts" && (
        <div className={sectionCls}>
          <label className={labelCls}>교체 부품명 <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={partsName}
            onChange={e => setPartsName(e.target.value)}
            placeholder="예: 도어 세이프티 슈, 브레이크 패드"
            lang="ko"
            className={inputCls}
          />
        </div>
      )}

      {/* 작업 내용 + 위험요소 */}
      <div className={sectionCls}>
        <label className={labelCls}>작업 내용 <span className="text-red-500">*</span></label>
        <textarea
          ref={workContentRef}
          value={workContent}
          onChange={e => setWorkContent(e.target.value)}
          placeholder="수행할 작업 내용을 상세히 입력하세요..."
          rows={3}
          lang="ko"
          className={inputCls + " resize-none"}
        />
        <label className={labelCls + " mt-3"}>위험요소 / 특이사항</label>
        <textarea
          value={riskAssessment}
          onChange={e => setRiskAssessment(e.target.value)}
          placeholder="예상 위험요소 및 특이사항..."
          rows={2}
          lang="ko"
          className={inputCls + " resize-none"}
        />
      </div>

      {/* 체크리스트 */}
      {visibleChecklist.length > 0 && (
        <div className={sectionCls}>
          <label className={labelCls}>
            ✅ {checklistType === "repair" ? "작업 전 안전조치 확인" : "점검 항목 사전 확인"}
          </label>
          <div className="space-y-1.5">
            {visibleChecklist.map(item => {
              const checked = checkedItems.has(item.id);
              return (
                <label
                  key={item.id}
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${
                    checked
                      ? "border-green-400 bg-green-50 dark:bg-green-900/20"
                      : "border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setCheckedItems(s => toggleSet(s, item.id))}
                    className="sr-only"
                  />
                  <span
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs font-bold ${
                      checked ? "bg-green-500 border-green-500 text-white" : "border-gray-400"
                    }`}
                  >{checked && "✓"}</span>
                  <span className="text-xs text-gray-700 dark:text-gray-200">{item.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* 안전수칙 */}
      <div className={sectionCls}>
        <label className={labelCls}>⚠️ 안전수칙 선택 ({selectedRules.size}건)</label>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {(["all","electric","repair","maintain","rescue","weld"] as SafetyCategory[]).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setRuleCategory(c)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                ruleCategory === c
                  ? "bg-blue-500 text-white border-blue-500"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600"
              }`}
            >{CATEGORY_LABELS[c]}</button>
          ))}
        </div>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {filteredRules.map(r => {
            const sel = selectedRules.has(r.id);
            return (
              <label
                key={r.id}
                className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${
                  sel
                    ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-200 dark:border-gray-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={sel}
                  onChange={() => setSelectedRules(s => toggleSet(s, r.id))}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-gray-700 dark:text-gray-200">{r.text}</div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {r.code} · {CATEGORY_LABELS[r.category]} · {SEASON_LABELS[r.season]}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* 참가자 */}
      <div className={sectionCls}>
        <label className={labelCls}>👷 작업 참가자 ({participants.length}명)</label>
        <input
          ref={participantSearchRef}
          type="text"
          value={participantSearch}
          onChange={e => { setParticipantSearch(e.target.value); setParticipantHighlighted(0); }}
          onKeyDown={e => {
            if ((e.nativeEvent as KeyboardEvent["nativeEvent"] & { isComposing?: boolean }).isComposing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setParticipantHighlighted(h => Math.min(h + 1, filteredParticipants.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setParticipantHighlighted(h => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              if (filteredParticipants.length === 0) return;
              e.preventDefault();
              const target = filteredParticipants.length === 1
                ? filteredParticipants[0]
                : filteredParticipants[participantHighlighted];
              if (target) {
                setParticipants(p => [...p, target]);
                setParticipantSearch("");
                setParticipantHighlighted(0);
                // 참가자는 다중 등록이 일반적이므로 검색창에 포커스 유지
              }
            }
          }}
          placeholder="이름 또는 부서 검색 (↓·↑·Enter)"
          lang="ko"
          autoComplete="off"
          className={inputCls}
        />
        {filteredParticipants.length > 0 && (
          <div className="mt-2 border border-gray-200 dark:border-gray-600 rounded-lg max-h-48 overflow-y-auto">
            {filteredParticipants.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={e => {
                  e.preventDefault();
                  setParticipants(p => [...p, u]);
                  setParticipantSearch("");
                  setParticipantHighlighted(0);
                  participantSearchRef.current?.focus();
                }}
                onMouseEnter={() => setParticipantHighlighted(i)}
                className={`w-full px-3 py-2 text-left text-sm border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
                  i === participantHighlighted
                    ? "bg-blue-100 dark:bg-blue-900/40"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <span className="font-semibold text-gray-800 dark:text-gray-100">{u.name}</span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-2">{u.dept}</span>
              </button>
            ))}
          </div>
        )}
        {participants.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {participants.map(p => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[11px] font-semibold"
              >
                {p.name}
                <button
                  type="button"
                  onClick={() => setParticipants(prev => prev.filter(x => x.id !== p.id))}
                  className="hover:text-red-500"
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 사진 */}
      <div className={sectionCls}>
        <label className={labelCls}>📷 사진 ({photos.length}장)</label>
        <label className="block w-full py-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-center cursor-pointer hover:border-blue-400 transition-colors">
          <input
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            onChange={onPhotoChange}
            className="hidden"
          />
          <div className="text-2xl mb-1">📸</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">탭하여 사진 촬영 또는 업로드</div>
        </label>
        {photoPreviews.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {photoPreviews.map((src, i) => (
              <div key={i} className="relative aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="w-full h-full object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold"
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 서명 */}
      <div className={sectionCls}>
        <label className={labelCls}>✍️ 작업책임자 서명 ({user?.name})</label>
        <SignaturePad ref={sigPadRef} />
      </div>

      {/* 에러 + 제출 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-xs px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full py-3.5 rounded-xl bg-slate-800 dark:bg-blue-600 text-white font-bold text-sm hover:bg-slate-900 dark:hover:bg-blue-500 disabled:opacity-50 transition-colors sticky bottom-2"
      >
        {saving ? "저장 중..." : "📤 TBM 작성 완료"}
      </button>
    </form>
  );
}
