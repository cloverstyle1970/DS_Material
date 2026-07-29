"use client";

import { useState, useEffect, useRef, FormEvent, KeyboardEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  TBMMode, TBMSubType, SafetyRule, RepairType, FaultType, ChecklistItem,
  SafetyCategory,
  MODE_LABELS, SUB_TYPE_LABELS, SUB_TYPE_ICONS, CATEGORY_LABELS, SEASON_LABELS,
} from "@/lib/tbm";
import { insertNotification } from "@/lib/notify";
import { calcApparentTemperature, heatStressLevel } from "@/lib/apparent-temperature";
import { fetchCurrentWeather } from "@/lib/weather";
import SignaturePad, { SignaturePadHandle } from "./SignaturePad";
import Combobox, { ComboboxHandle } from "./Combobox";
import TimeText from "@/components/work-journal/TimeText";

interface EnvReading {
  seq: number;
  observed_at: string;         // HH:MM
  temperature: string;         // ℃
  humidity: string;            // %
  apparent_temperature: string;
  location: string;
}
interface HeatRest {
  seq: number;
  rest_start: string;          // HH:MM
  rest_end: string;            // HH:MM
  rest_method: string;
}

interface Site { id: number; name: string }
interface Elevator { id: number; site_name: string; unit_name: string }
interface UserMini { id: number; name: string | null; dept: string | null }
interface Worker { name: string; user_id: number | null }
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
  const [heatPrevention, setHeatPrevention] = useState(false);
  const [envReadings, setEnvReadings] = useState<EnvReading[]>([]);
  const [heatRests, setHeatRests] = useState<HeatRest[]>([
    { seq: 1, rest_start: "", rest_end: "", rest_method: "" },
  ]);

  // 환경지표 즉시 입력값 (내용저장 시 envReadings에 append)
  const [envTemperature, setEnvTemperature] = useState("");
  const [envHumidity, setEnvHumidity] = useState("");
  const [envApparent, setEnvApparent] = useState("");
  const [envLocation, setEnvLocation] = useState("");
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherHint, setWeatherHint] = useState("");
  const [envSaveHint, setEnvSaveHint] = useState("");
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());
  const [selectedRules, setSelectedRules] = useState<Set<number>>(new Set());
  // 작업 참가자 (작성자 포함 최소 2인, 각 인원은 자신의 서명을 함께 등록)
  const [workers, setWorkers] = useState<Worker[]>([
    { name: "", user_id: null },
    { name: "", user_id: null },
  ]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [ruleCategory, setRuleCategory] = useState<SafetyCategory>("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 각 참가자별 서명 pad ref (인덱스 매칭)
  const workerSigRefs = useRef<(SignaturePadHandle | null)[]>([]);
  // 키보드 네비게이션용 refs
  const elevatorRef = useRef<ComboboxHandle>(null);
  const workContentRef = useRef<HTMLTextAreaElement>(null);
  const elevatorInputRef = useRef<HTMLInputElement>(null);

  // ------- 마스터 로드 -------
  useEffect(() => {
    (async () => {
      const [sr, rt, ft, ci, st, ev, us] = await Promise.all([
        supabase.from("tbm_safety_rules_master").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("tbm_repair_types").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("tbm_fault_types").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("tbm_checklist_items").select("*").eq("is_active", true).order("sort_order"),
        // 신DB: 현장=managed_sites(site_name→name 별칭), 호기=site_elevators(site_id), 사원=accounts(username→name)
        supabase.from("managed_sites").select("id, name:site_name").order("site_name"),
        supabase.from("site_elevators").select("id, site_id, installation_place, unit_name").order("installation_place"),
        supabase.from("accounts").select("id, name:username, dept").eq("status", "재직").order("username"),
      ]);
      if (sr.data) setSafetyRules(sr.data as SafetyRule[]);
      if (rt.data) setRepairTypes(rt.data as RepairType[]);
      if (ft.data) setFaultTypes(ft.data as FaultType[]);
      if (ci.data) setChecklistItems(ci.data as ChecklistItem[]);
      if (st.data) setSites(st.data as Site[]);
      if (ev.data) {
        // site_elevators 는 site_id FK → 현장명으로 평탄화
        // 호기 식별 기준은 installation_place (비어있을 때만 unit_name fallback)
        const siteName = new Map((st.data ?? []).map(s => [(s as { id: number }).id, (s as { name: string }).name]));
        setElevators((ev.data as { id: number; site_id: number; installation_place: string | null; unit_name: string | null }[])
          .map(e => ({ id: e.id, site_name: siteName.get(e.site_id) ?? "", unit_name: e.installation_place ?? e.unit_name ?? "" })) as Elevator[]);
      }
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

  // 로그인 사용자 도착 시 첫 참가자에 자동 세팅 (아직 비어있을 때만)
  useEffect(() => {
    if (!user) return;
    setWorkers(prev => {
      if (prev[0]?.user_id === user.id) return prev;
      if (prev[0]?.name.trim() !== "") return prev;
      const next = [...prev];
      next[0] = { name: user.name ?? "", user_id: user.id };
      return next;
    });
  }, [user]);

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

  async function uploadSignatureRef(ref: SignaturePadHandle | null): Promise<string | null> {
    if (!ref || ref.isEmpty()) return null;
    const dataUrl = ref.getDataURL();
    if (!dataUrl) return null;
    const blob = await (await fetch(dataUrl)).blob();
    return await uploadFile(blob, "png");
  }

  // ---- 참가자(작업자) 헬퍼 ----
  function updateWorker(idx: number, patch: Partial<Worker>) {
    setWorkers(prev => prev.map((w, i) => i === idx ? { ...w, ...patch } : w));
  }
  function pickWorkerByName(idx: number, name: string) {
    const found = users.find(u => (u.name ?? "").trim() === name.trim());
    updateWorker(idx, { name, user_id: found?.id ?? null });
  }
  function addWorker() {
    setWorkers(prev => [...prev, { name: "", user_id: null }]);
  }
  function removeWorker(idx: number) {
    setWorkers(prev => {
      if (prev.length <= 2) return prev; // 작성자 포함 최소 2인 유지
      if (idx === 0) return prev;        // 작성자(첫번째)는 삭제 불가
      workerSigRefs.current.splice(idx, 1);
      return prev.filter((_, i) => i !== idx);
    });
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
    setHeatPrevention(false);
    setEnvReadings([]);
    setEnvTemperature(""); setEnvHumidity(""); setEnvApparent(""); setEnvLocation("");
    setWeatherHint(""); setEnvSaveHint("");
    setHeatRests([{ seq: 1, rest_start: "", rest_end: "", rest_method: "" }]);
    setCheckedItems(new Set()); setSelectedRules(new Set());
    setWorkers([
      { name: user?.name ?? "", user_id: user?.id ?? null },
      { name: "", user_id: null },
    ]);
    workerSigRefs.current.forEach(ref => ref?.clear());
    workerSigRefs.current = [];
    setPhotos([]); setPhotoPreviews([]);
  }

  function currentTimeHM(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // 온도·습도 변경 시 체감온도 자동 계산 (수동 입력을 덮지 않기 위해 값이 비어 있을 때만)
  useEffect(() => {
    if (envTemperature === "" || envHumidity === "") return;
    if (envApparent !== "") return; // 사용자가 이미 입력한 경우 유지
    const t = Number(envTemperature);
    const h = Number(envHumidity);
    if (Number.isNaN(t) || Number.isNaN(h)) return;
    const apt = calcApparentTemperature(t, h);
    if (apt !== null) setEnvApparent(apt.toFixed(1));
  }, [envTemperature, envHumidity, envApparent]);

  function saveEnvReading() {
    setEnvSaveHint(""); setError("");
    if (envTemperature === "" && envHumidity === "" && envApparent === "") {
      setError("저장할 온도·습도·체감온도 값이 없습니다. 먼저 값을 입력하거나 실시간 기상정보를 조회하세요.");
      return;
    }
    const at = currentTimeHM();
    setEnvReadings(prev => [
      ...prev,
      {
        seq: prev.length + 1,
        observed_at: at,
        temperature: envTemperature,
        humidity: envHumidity,
        apparent_temperature: envApparent,
        location: envLocation,
      },
    ]);
    setEnvSaveHint(`✓ ${at} 값이 저장되었습니다`);
  }

  async function loadCurrentWeather() {
    setWeatherLoading(true); setWeatherHint(""); setError("");
    try {
      const w = await fetchCurrentWeather();
      setEnvTemperature(w.temperature.toFixed(1));
      setEnvHumidity(Math.round(w.humidity).toString());
      const apt = calcApparentTemperature(w.temperature, w.humidity);
      if (apt !== null) setEnvApparent(apt.toFixed(1));
      setEnvLocation(w.location);
      const t = new Date(w.observedAt);
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      const locSuffix = w.location ? ` · 📍 ${w.location}` : "";
      setWeatherHint(`✓ ${hh}:${mm} 관측값 반영됨${locSuffix}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWeatherLoading(false);
    }
  }

  // ---- 환경지표 헬퍼 ----
  function updateEnvReading(idx: number, patch: Partial<EnvReading>) {
    setEnvReadings(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, ...patch };
      // 온도·습도가 모두 있으면 체감온도 자동 계산 (수동 입력 없을 때만 덮어씀)
      if ((patch.temperature !== undefined || patch.humidity !== undefined) && patch.apparent_temperature === undefined) {
        const t = Number(next.temperature);
        const h = Number(next.humidity);
        if (!Number.isNaN(t) && !Number.isNaN(h) && next.temperature !== "" && next.humidity !== "") {
          const apt = calcApparentTemperature(t, h);
          if (apt !== null) next.apparent_temperature = apt.toFixed(1);
        }
      }
      return next;
    }));
  }
  function removeEnvReading(idx: number) {
    setEnvReadings(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, seq: i + 1 })));
  }

  // ---- 온열질환 예방 휴게 헬퍼 ----
  function updateHeatRest(idx: number, patch: Partial<HeatRest>) {
    setHeatRests(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function addHeatRest() {
    setHeatRests(prev => [...prev, { seq: prev.length + 1, rest_start: "", rest_end: "", rest_method: "" }]);
  }
  function removeHeatRest(idx: number) {
    setHeatRests(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, seq: i + 1 })));
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
    // 참가자: 작성자 포함 최소 2인, 각자 성명·사원 매칭 필수
    if (workers.length < 2) { setError("작업 참가자는 작성자 포함 최소 2인이 필요합니다."); return; }
    for (let i = 0; i < workers.length; i++) {
      if (!workers[i].name.trim()) { setError(`참가자 ${i + 1} 성명을 입력하세요.`); return; }
      if (workers[i].user_id == null) { setError(`참가자 ${i + 1}(${workers[i].name})을(를) 사원 목록에서 선택하세요.`); return; }
    }
    // 중복 사원 방지 (tbm_participants PK = tbm_id + user_id)
    {
      const ids = workers.map(w => w.user_id);
      const uniq = new Set(ids);
      if (uniq.size !== ids.length) { setError("참가자가 중복되었습니다. 중복된 사원을 제거하세요."); return; }
    }
    // 작성자(첫번째) 서명은 필수, 나머지는 미서명 시 알림 발송
    if (!workerSigRefs.current[0] || workerSigRefs.current[0].isEmpty()) {
      setError("작성자 서명을 입력하세요.");
      return;
    }

    setSaving(true);
    try {
      // 1. 사진/서명(작성자 + 참가자) 업로드
      const [photoUrls, workerSigUrls] = await Promise.all([
        uploadPhotos(),
        Promise.all(workers.map((_, i) => uploadSignatureRef(workerSigRefs.current[i]))),
      ]);
      const sigUrl = workerSigUrls[0]; // 작성자 서명 = tbm_records.signature_url

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

      // 참가자 insert — 각자의 서명(작성자는 필수, 나머지는 있을 때만)
      tasks.push(supabase.from("tbm_participants").insert(
        workers.map((w, i) => ({
          tbm_id: tbmId,
          user_id: w.user_id!,
          user_name: w.name.trim(),
          signature_url: workerSigUrls[i],
          // 작성자(첫번째)와 서명한 참가자는 즉시 확인 완료 처리
          confirmed_at: workerSigUrls[i] ? new Date().toISOString() : null,
        }))
      ));

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

      // 환경지표 (온도·습도·체감온도·지역 중 하나라도 있는 행만) — 폭염 예방 체크 시에만
      const envRows = heatPrevention ? envReadings.filter(r =>
        r.temperature !== "" || r.humidity !== "" || r.apparent_temperature !== "" || r.location.trim() !== "" || r.observed_at !== ""
      ) : [];
      if (envRows.length > 0) {
        tasks.push(supabase.from("tbm_env_readings").insert(
          envRows.map((r, i) => ({
            tbm_id: tbmId,
            seq: i + 1,
            observed_at: r.observed_at || null,
            temperature: r.temperature === "" ? null : Number(r.temperature),
            humidity: r.humidity === "" ? null : Number(r.humidity),
            apparent_temperature: r.apparent_temperature === "" ? null : Number(r.apparent_temperature),
            location: r.location.trim() || null,
          }))
        ));
      }

      // 온열질환 예방 휴게 (시작·종료·휴게방법 중 하나라도 있는 행만) — 폭염 예방 체크 시에만
      const restRows = heatPrevention ? heatRests.filter(r =>
        r.rest_start !== "" || r.rest_end !== "" || r.rest_method.trim() !== ""
      ) : [];
      if (restRows.length > 0) {
        tasks.push(supabase.from("tbm_heat_rests").insert(
          restRows.map((r, i) => ({
            tbm_id: tbmId,
            seq: i + 1,
            rest_start: r.rest_start || null,
            rest_end: r.rest_end || null,
            rest_method: r.rest_method.trim() || null,
          }))
        ));
      }

      const results = await Promise.all(tasks);
      const insertErr = results.find(r => r.error);
      if (insertErr?.error) throw new Error(insertErr.error.message);

      // 4. 미서명 참가자에게 서명 요청 알림 (작성자 제외, 실패해도 저장은 성공 처리)
      const unsignedTargets = workers
        .map((w, i) => ({ w, sigUrl: workerSigUrls[i] }))
        .filter(x => !x.sigUrl && x.w.user_id && x.w.user_id !== user.id);
      if (unsignedTargets.length > 0) {
        const sitePart = siteName.trim();
        const elevPart = elevatorName.trim() ? ` ${elevatorName.trim()}` : "";
        const summary = workContent.trim().replace(/\s+/g, " ").slice(0, 40);
        (async () => {
          await Promise.all(unsignedTargets.map(x => insertNotification({
            userId:  x.w.user_id!,
            type:    "tbm_participant",
            title:   "TBM 서명이 필요합니다",
            message: `[${sitePart}${elevPart}] ${user.name ?? ""} · ${summary}`,
            link:    "/safety/tbm",
            refType: "tbm_record",
            refId:   tbmId,
          })));
        })().catch(e => console.warn("[notify] TBM 서명 요청 알림 실패:", e));
      }

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

      {/* 폭염 온열질환 예방 토글 */}
      <div className={sectionCls}>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={heatPrevention}
            onChange={e => setHeatPrevention(e.target.checked)}
            className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-orange-500 focus:ring-orange-400"
          />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            🥵 폭염 온열질환 예방
          </span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            (체크 시 환경지표·휴게 실시 확인 입력)
          </span>
        </label>
      </div>

      {/* 환경 지표 (기상정보) — 폭염 예방 체크 시에만 노출 */}
      {heatPrevention && (() => {
        const scratchInfo = heatStressLevel(envApparent === "" ? null : Number(envApparent));
        const aptCellCls = scratchInfo
          ? `border p-0.5 ${scratchInfo.colorClass}`
          : "border border-gray-300 dark:border-gray-600 p-0.5";
        const inputBaseCls = "w-full px-2 py-1.5 text-sm text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded";
        return (
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + " mb-0"}>🌡️ 환경 지표</label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={saveEnvReading}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                >
                  💾 내용저장
                </button>
                <button
                  type="button"
                  onClick={loadCurrentWeather}
                  disabled={weatherLoading}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50"
                >
                  {weatherLoading ? "⏳ 조회 중..." : "📡 실시간 기상정보"}
                </button>
              </div>
            </div>
            {weatherHint && (
              <div className="text-[10px] text-green-600 dark:text-green-400 mb-2">{weatherHint}</div>
            )}
            {envSaveHint && (
              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mb-2">{envSaveHint}</div>
            )}
            {/* 즉시 입력 행 */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700">
                    <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">온도(℃)</th>
                    <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">습도(%)</th>
                    <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">체감온도</th>
                    <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">지역정보</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                      <input type="number" step="0.1" value={envTemperature}
                        onChange={e => setEnvTemperature(e.target.value)}
                        className={inputBaseCls} />
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                      <input type="number" step="0.1" value={envHumidity}
                        onChange={e => setEnvHumidity(e.target.value)}
                        className={inputBaseCls} />
                    </td>
                    <td className={aptCellCls}>
                      <div className="flex items-center justify-center gap-1">
                        <input type="number" step="0.1" value={envApparent}
                          onChange={e => setEnvApparent(e.target.value)}
                          className={`w-16 px-1 py-1.5 text-sm text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded ${scratchInfo ? "font-bold" : ""}`} />
                        {scratchInfo && <span className="text-[11px] font-bold">({scratchInfo.label})</span>}
                      </div>
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                      <input type="text" value={envLocation}
                        onChange={e => setEnvLocation(e.target.value)}
                        placeholder="📍 지역"
                        lang="ko"
                        className={inputBaseCls} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 체감온도 → 온열질환 단계 안내 */}
            {scratchInfo && (
              <div className={`mt-2 w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 ${scratchInfo.colorClass}`}>
                <div className="text-2xl leading-none shrink-0">
                  {scratchInfo.level === "safe" ? "🟢" : scratchInfo.level === "caution" ? "🟡" : scratchInfo.level === "warning" ? "🟠" : "🔴"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold">
                    온열질환 <span className="text-base">{scratchInfo.label}</span>
                    <span className="ml-2 text-xs font-normal opacity-80">(체감온도 {Number(envApparent).toFixed(1)}℃)</span>
                  </div>
                  <div className="text-xs font-normal mt-0.5 opacity-90">{scratchInfo.advice}</div>
                </div>
              </div>
            )}

            {/* 저장된 기상정보 목록 */}
            {envReadings.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                  저장된 기상정보 ({envReadings.length}건)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700">
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">시각</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">온도(℃)</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">습도(%)</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-24">체감온도</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">지역정보</th>
                        <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {envReadings.map((r, idx) => {
                        const info = heatStressLevel(r.apparent_temperature === "" ? null : Number(r.apparent_temperature));
                        const aptCls = info
                          ? `border p-0.5 ${info.colorClass}`
                          : "border border-gray-300 dark:border-gray-600 p-0.5";
                        return (
                          <tr key={idx}>
                            <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                              <input type="time" value={r.observed_at}
                                onChange={e => updateEnvReading(idx, { observed_at: e.target.value })}
                                className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                            </td>
                            <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                              <input type="number" step="0.1" value={r.temperature}
                                onChange={e => updateEnvReading(idx, { temperature: e.target.value })}
                                className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                            </td>
                            <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                              <input type="number" step="0.1" value={r.humidity}
                                onChange={e => updateEnvReading(idx, { humidity: e.target.value })}
                                className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                            </td>
                            <td className={aptCls}>
                              <div className="flex items-center justify-center gap-1">
                                <input type="number" step="0.1" value={r.apparent_temperature}
                                  onChange={e => updateEnvReading(idx, { apparent_temperature: e.target.value })}
                                  className={`w-14 px-1 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded ${info ? "font-bold" : ""}`} />
                                {info && <span className="text-[10px] font-bold">({info.label})</span>}
                              </div>
                            </td>
                            <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                              <input type="text" value={r.location}
                                onChange={e => updateEnvReading(idx, { location: e.target.value })}
                                placeholder="📍 지역"
                                lang="ko"
                                className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                            </td>
                            <td className="border border-gray-300 dark:border-gray-600 p-0.5 text-center">
                              <button
                                type="button"
                                onClick={() => removeEnvReading(idx)}
                                title="행 삭제"
                                className="w-7 h-7 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                              >×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* 온열질환 예방 휴게 실시 확인 — 폭염 예방 체크 시에만 노출 */}
      {heatPrevention && (
      <div className={sectionCls}>
        <label className={labelCls}>🥵 온열질환 예방 휴게 실시 확인</label>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700">
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-24">휴게 시작</th>
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-24">휴게 종료</th>
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">휴게방법</th>
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {heatRests.map((r, idx) => (
                <tr key={idx}>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <TimeText value={r.rest_start}
                      onChange={v => updateHeatRest(idx, { rest_start: v })}
                      placeholder="HH:MM"
                      className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded placeholder:text-gray-400" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <TimeText value={r.rest_end}
                      onChange={v => updateHeatRest(idx, { rest_end: v })}
                      placeholder="HH:MM"
                      className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded placeholder:text-gray-400" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <input type="text" value={r.rest_method}
                      onChange={e => updateHeatRest(idx, { rest_method: e.target.value })}
                      placeholder="예: 그늘 휴식, 냉방실 이동, 수분·염분 보충"
                      lang="ko"
                      className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5 text-center">
                    <button
                      type="button"
                      onClick={() => removeHeatRest(idx)}
                      disabled={heatRests.length <= 1}
                      title="행 삭제"
                      className="w-7 h-7 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-30 disabled:cursor-not-allowed"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addHeatRest}
          className="mt-2 w-full py-2 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-300 border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
          + 행 추가
        </button>
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

      {/* 참가자 (작성자 포함 최소 2인, 각자 서명 함께 등록) */}
      <div className={sectionCls}>
        <label className={labelCls}>
          👷 작업 참가자 확인 ({workers.length}명) <span className="text-red-600 dark:text-red-400 font-bold">(작성자 포함 최소 2인, 작성자 서명 필수 — 미서명자에게 알림 발송)</span>
        </label>

        {workers.map((w, idx) => (
          <div key={idx} className="mb-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-gray-700 dark:text-gray-200">
                참가자 {idx + 1} <span className="text-red-500">*</span>
                {idx === 0 && (
                  <span className="ml-2 text-[10px] font-normal text-blue-600 dark:text-blue-300">(작성자 자동)</span>
                )}
              </div>
              {idx > 0 && workers.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeWorker(idx)}
                  className="text-[11px] text-red-500 hover:underline"
                >삭제</button>
              )}
            </div>
            <div className="mb-2">
              <label className={labelCls}>성명</label>
              <input
                type="text"
                value={w.name}
                onChange={e => pickWorkerByName(idx, e.target.value)}
                placeholder="성명 (사원 목록에서 선택)"
                lang="ko"
                list={`tbm-worker-list-${idx}`}
                className={inputCls}
              />
              <datalist id={`tbm-worker-list-${idx}`}>
                {users.map(u => <option key={u.id} value={u.name ?? ""}>{u.dept ?? ""}</option>)}
              </datalist>
              {w.name.trim() && w.user_id == null && (
                <div className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                  ※ 사원 목록에 없는 이름입니다. 목록에서 정확히 선택하세요.
                </div>
              )}
            </div>
            <label className={labelCls}>
              서명 {idx === 0
                ? <span className="text-[10px] font-normal text-red-600 dark:text-red-400">(작성자 필수)</span>
                : <span className="text-[10px] font-normal text-gray-500">(미서명 시 알림 발송)</span>}
            </label>
            <SignaturePad
              ref={el => { workerSigRefs.current[idx] = el; }}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={addWorker}
          className="w-full py-2 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-300 border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
          + 참가자 추가
        </button>
      </div>

      {/* 사진 */}
      <div className={sectionCls}>
        <label className={labelCls}>📷 사진 ({photos.length}장)</label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={onPhotoChange}
              className="hidden"
            />
            <div className="text-2xl mb-1">📸</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">카메라 촬영</div>
          </label>
          <label className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={onPhotoChange}
              className="hidden"
            />
            <div className="text-2xl mb-1">🖼️</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">사진 업로드</div>
          </label>
        </div>
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
