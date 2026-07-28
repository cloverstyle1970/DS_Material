"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { calcApparentTemperature, heatStressLevel } from "@/lib/apparent-temperature";
import { fetchCurrentWeather } from "@/lib/weather";
import { netWorkMinutes, splitHM } from "@/lib/work-hours";
import { insertNotification } from "@/lib/notify";
import SignaturePad, { SignaturePadHandle } from "../tbm/SignaturePad";
import TimeText from "./TimeText";

interface Site { id: number; name: string }
interface Elevator { id: number; site_name: string; unit_name: string }
interface UserMini { id: number; name: string | null; dept: string | null; rank: string | null }

interface JournalItem {
  seq: number;
  unit_no: string;
  work_category: string;
  work_content: string;
  work_start: string;  // HH:MM
  work_end: string;    // HH:MM
  action_result: string;
}

interface HeatRest {
  seq: number;
  rest_start: string;  // HH:MM
  rest_end: string;    // HH:MM
  rest_method: string; // 휴게방법 (자유 입력)
}

interface Worker {
  name: string;
  user_id: number | null;
}

interface EnvReading {
  seq: number;
  observed_at: string;         // HH:MM
  temperature: string;
  humidity: string;
  apparent_temperature: string;
  location: string;
}

// 초기 3행은 빈 시간으로 시작 — 사용자가 실제 휴게 시각을 직접 입력
const HEAT_REST_TEMPLATE: HeatRest[] = [
  { seq: 1, rest_start: "", rest_end: "", rest_method: "" },
  { seq: 2, rest_start: "", rest_end: "", rest_method: "" },
  { seq: 3, rest_start: "", rest_end: "", rest_method: "" },
  { seq: 4, rest_start: "", rest_end: "", rest_method: "" },
  { seq: 5, rest_start: "", rest_end: "", rest_method: "" },
];
const INITIAL_HEAT_REST_ROWS = 3;

const STORAGE_BUCKET = "tbm-photos"; // TBM과 동일한 버킷 재사용

// 자바스크립트 Date → 한국어 요일
function weekdayKo(d: Date): string {
  return ["일","월","화","수","목","금","토"][d.getDay()];
}

// YYYY-MM-DD 로컬 오늘
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function WorkJournalWriteForm({
  onSaved, editingJournalId,
}: {
  onSaved: () => void;
  editingJournalId?: number | null;
}) {
  const { user } = useAuth();

  // 마스터 데이터
  const [sites, setSites] = useState<Site[]>([]);
  const [elevators, setElevators] = useState<Elevator[]>([]);
  const [users, setUsers] = useState<UserMini[]>([]);

  // 기본 정보
  const [workDate, setWorkDate] = useState<string>(todayISO());
  const [weekday, setWeekday]   = useState<string>(weekdayKo(new Date()));
  const [weather, setWeather]   = useState("");
  const [siteName, setSiteName] = useState("");
  const [elevatorUniqueNo, setElevatorUniqueNo] = useState("");

  // 환경 (현재 대표값)
  const [temperature, setTemperature]                   = useState("");
  const [humidity, setHumidity]                         = useState("");
  const [apparentTemperature, setApparentTemperature]   = useState("");

  // 환경 지표 로그 (시간대별로 누적 저장)
  const [envReadings, setEnvReadings] = useState<EnvReading[]>([]);
  const [envSaveHint, setEnvSaveHint] = useState<string>("");

  // 근무
  const [baseWorkStart, setBaseWorkStart] = useState("08:30");
  const [baseWorkEnd, setBaseWorkEnd]     = useState("17:30");
  const [overtimeStart, setOvertimeStart] = useState("");
  const [overtimeEnd, setOvertimeEnd]     = useState("");
  const [overtimeHours, setOvertimeHours]     = useState("0");
  const [overtimeMinutes, setOvertimeMinutes] = useState("0");

  // 작업 구분
  const [catInspection, setCatInspection] = useState(false);
  const [catFault, setCatFault]           = useState(false);
  const [catRepair, setCatRepair]         = useState(false);

  // 호기별 작업 (기본 3줄, 추가·삭제 가능)
  const [items, setItems] = useState<JournalItem[]>(
    Array.from({ length: 3 }, (_, i) => ({
      seq: i + 1, unit_no: "", work_category: "", work_content: "", work_start: "", work_end: "", action_result: "",
    }))
  );

  // 온열질환 예방 휴게 (기본 3줄, 추가·삭제 가능)
  const [heatRests, setHeatRests] = useState<HeatRest[]>(
    HEAT_REST_TEMPLATE.slice(0, INITIAL_HEAT_REST_ROWS).map(t => ({ ...t }))
  );

  // 특이사항
  const [specialNotes, setSpecialNotes] = useState("");

  // 작업자 (최소 2인, 첫 번째는 로그인 사용자 자동)
  const [workers, setWorkers] = useState<Worker[]>([
    { name: "", user_id: null },
    { name: "", user_id: null },
  ]);

  // 서명 — 작업자는 배열(callback ref)
  const workerSigRefs = useRef<(SignaturePadHandle | null)[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 실시간 기상정보 조회
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherHint, setWeatherHint]       = useState<string>("");
  const [weatherLocation, setWeatherLocation] = useState<string>("");

  function currentTimeHM(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function saveEnvReading() {
    setEnvSaveHint("");
    setError("");
    if (temperature === "" && humidity === "" && apparentTemperature === "") {
      setError("저장할 온도·습도·체감온도 값이 없습니다. 먼저 값을 입력하거나 실시간 기상정보를 조회하세요.");
      return;
    }
    setEnvReadings(prev => [
      ...prev,
      {
        seq: prev.length + 1,
        observed_at: currentTimeHM(),
        temperature,
        humidity,
        apparent_temperature: apparentTemperature,
        location: weatherLocation,
      },
    ]);
    setEnvSaveHint(`✓ ${currentTimeHM()} 값이 저장되었습니다`);
  }

  function updateEnvReading(idx: number, patch: Partial<EnvReading>) {
    setEnvReadings(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function removeEnvReading(idx: number) {
    setEnvReadings(prev => prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, seq: i + 1 })));
  }

  async function loadCurrentWeather() {
    setWeatherLoading(true);
    setWeatherHint("");
    setError("");
    try {
      const w = await fetchCurrentWeather();
      setTemperature(w.temperature.toFixed(1));
      setHumidity(Math.round(w.humidity).toString());
      // 날씨 라벨이 빈 문자열이 아닐 때만 자동 채움
      if (w.weatherLabel) setWeather(w.weatherLabel);
      setWeatherLocation(w.location);
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

  // 마스터 로드
  useEffect(() => {
    (async () => {
      const [st, ev, us] = await Promise.all([
        supabase.from("managed_sites").select("id, name:site_name").order("site_name"),
        supabase.from("site_elevators").select("id, site_id, installation_place, unit_name").order("installation_place"),
        supabase.from("accounts").select("id, name:username, dept, rank").eq("status", "재직").order("username"),
      ]);
      if (st.data) setSites(st.data as Site[]);
      if (ev.data) {
        const siteMap = new Map((st.data ?? []).map(s => [(s as { id: number }).id, (s as { name: string }).name]));
        setElevators((ev.data as { id: number; site_id: number; installation_place: string | null; unit_name: string | null }[])
          .map(e => ({
            id: e.id,
            site_name: siteMap.get(e.site_id) ?? "",
            unit_name: e.installation_place ?? e.unit_name ?? "",
          })));
      }
      if (us.data) setUsers(us.data as UserMini[]);
    })();
  }, []);

  // 로그인 사용자를 첫 번째 작업자로 자동 채움 (신규 작성 모드에서만)
  useEffect(() => {
    if (!user || editingJournalId) return;
    setWorkers(prev => {
      if (prev[0]?.name) return prev;
      const copy = [...prev];
      copy[0] = { name: user.name ?? "", user_id: user.id };
      return copy;
    });
  }, [user, editingJournalId]);

  // 수정 모드: 저널을 로드해 state에 채움 (참가자·서명은 편집 대상에서 제외)
  useEffect(() => {
    if (!editingJournalId) return;
    (async () => {
      const [j, it, hr, en] = await Promise.all([
        supabase.from("work_journals").select("*").eq("id", editingJournalId).single(),
        supabase.from("work_journal_items").select("*").eq("journal_id", editingJournalId).order("seq"),
        supabase.from("work_journal_heat_rests").select("*").eq("journal_id", editingJournalId).order("seq"),
        supabase.from("work_journal_env_readings").select("*").eq("journal_id", editingJournalId).order("seq"),
      ]);
      const jd = j.data as {
        work_date: string; weekday: string | null; weather: string | null;
        site_name: string; elevator_unique_no: string;
        temperature: number | null; humidity: number | null; apparent_temperature: number | null;
        location: string | null;
        base_work_start: string | null; base_work_end: string | null;
        overtime_start: string | null; overtime_end: string | null;
        overtime_hours: number; overtime_minutes: number;
        category_inspection: boolean; category_fault: boolean; category_repair: boolean;
        special_notes: string;
      } | null;
      if (jd) {
        setWorkDate(jd.work_date);
        setWeekday(jd.weekday ?? "");
        setWeather(jd.weather ?? "");
        setSiteName(jd.site_name);
        setElevatorUniqueNo(jd.elevator_unique_no);
        setTemperature(jd.temperature?.toString() ?? "");
        setHumidity(jd.humidity?.toString() ?? "");
        setApparentTemperature(jd.apparent_temperature?.toString() ?? "");
        setWeatherLocation(jd.location ?? "");
        setBaseWorkStart(jd.base_work_start?.slice(0, 5) ?? "");
        setBaseWorkEnd(jd.base_work_end?.slice(0, 5) ?? "");
        setOvertimeStart(jd.overtime_start?.slice(0, 5) ?? "");
        setOvertimeEnd(jd.overtime_end?.slice(0, 5) ?? "");
        setOvertimeHours(String(jd.overtime_hours ?? 0));
        setOvertimeMinutes(String(jd.overtime_minutes ?? 0));
        setCatInspection(jd.category_inspection);
        setCatFault(jd.category_fault);
        setCatRepair(jd.category_repair);
        setSpecialNotes(jd.special_notes);
      }
      const itemRows = (it.data ?? []) as { seq: number; unit_no: string; work_category: string; work_content: string; work_start: string | null; work_end: string | null; action_result: string }[];
      if (itemRows.length > 0) {
        setItems(itemRows.map(r => ({
          seq: r.seq,
          unit_no: r.unit_no,
          work_category: r.work_category,
          work_content: r.work_content,
          work_start: r.work_start?.slice(0, 5) ?? "",
          work_end:   r.work_end?.slice(0, 5) ?? "",
          action_result: r.action_result,
        })));
      }
      const restRows = (hr.data ?? []) as { seq: number; rest_start: string | null; rest_end: string | null; rest_method: string | null }[];
      if (restRows.length > 0) {
        setHeatRests(restRows.map(r => ({
          seq: r.seq,
          rest_start: r.rest_start?.slice(0, 5) ?? "",
          rest_end:   r.rest_end?.slice(0, 5) ?? "",
          rest_method: r.rest_method ?? "",
        })));
      }
      const envRows = (en.data ?? []) as { seq: number; observed_at: string | null; temperature: number | null; humidity: number | null; apparent_temperature: number | null; location: string | null }[];
      if (envRows.length > 0) {
        setEnvReadings(envRows.map(r => ({
          seq: r.seq,
          observed_at: r.observed_at?.slice(0, 5) ?? "",
          temperature: r.temperature?.toString() ?? "",
          humidity: r.humidity?.toString() ?? "",
          apparent_temperature: r.apparent_temperature?.toString() ?? "",
          location: r.location ?? "",
        })));
      }
    })();
  }, [editingJournalId]);

  // 작업일자 변경 시 요일 자동 갱신
  useEffect(() => {
    if (!workDate) return;
    const d = new Date(workDate);
    if (!isNaN(d.getTime())) setWeekday(weekdayKo(d));
  }, [workDate]);

  // 온도·습도 변경 시 체감온도 자동 계산 (산업안전보건공단 2023 여름철 공식)
  // 온도 < 15℃ 또는 값 미입력 시 자동 갱신 안 함 (수동 입력값 유지)
  useEffect(() => {
    const t = Number(temperature);
    const h = Number(humidity);
    if (temperature === "" || humidity === "") return;
    const pt = calcApparentTemperature(t, h);
    if (pt !== null) setApparentTemperature(pt.toFixed(1));
  }, [temperature, humidity]);

  // 연장근무 시작·종료 변경 시 순 연장시간 자동 계산 (4시간마다 30분 휴게 차감)
  useEffect(() => {
    const net = netWorkMinutes(overtimeStart, overtimeEnd);
    if (net === null) return;
    const { hours, minutes } = splitHM(net);
    setOvertimeHours(hours.toString());
    setOvertimeMinutes(minutes.toString());
  }, [overtimeStart, overtimeEnd]);

  const visibleElevators = elevators.filter(e => e.site_name === siteName);

  function updateItem(idx: number, patch: Partial<JournalItem>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  function addItem() {
    setItems(prev => [
      ...prev,
      { seq: prev.length + 1, unit_no: "", work_category: "", work_content: "", work_start: "", work_end: "", action_result: "" },
    ]);
  }

  function removeItem(idx: number) {
    setItems(prev => {
      // 최소 1줄은 유지
      if (prev.length <= 1) return prev;
      // 삭제 후 seq 재부여 (1..N)
      return prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, seq: i + 1 }));
    });
  }

  function updateRest(idx: number, patch: Partial<HeatRest>) {
    setHeatRests(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function addHeatRest() {
    setHeatRests(prev => {
      const nextSeq = prev.length + 1;
      // 템플릿에 남은 시각이 있으면 자동 채움, 없으면 빈 행
      const tpl = HEAT_REST_TEMPLATE.find(t => t.seq === nextSeq);
      return [
        ...prev,
        {
          seq: nextSeq,
          rest_start: tpl?.rest_start ?? "",
          rest_end:   tpl?.rest_end   ?? "",
          rest_method: "",
        },
      ];
    });
  }

  function removeHeatRest(idx: number) {
    setHeatRests(prev => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx).map((r, i) => ({ ...r, seq: i + 1 }));
    });
  }

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
      // 최소 2인 유지
      if (prev.length <= 2) return prev;
      // 서명 ref 배열도 인덱스 맞춰 재구성 (해당 idx 삭제)
      workerSigRefs.current.splice(idx, 1);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function uploadFile(file: Blob, ext: string): Promise<string> {
    const path = `work-journal/${user!.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
      cacheControl: "3600", upsert: false,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function uploadSignatureRef(ref: React.RefObject<SignaturePadHandle | null>): Promise<string | null> {
    const pad = ref.current;
    if (!pad || pad.isEmpty()) return null;
    const dataUrl = pad.getDataURL();
    if (!dataUrl) return null;
    const blob = await (await fetch(dataUrl)).blob();
    return await uploadFile(blob, "png");
  }

  function resetForm() {
    setWorkDate(todayISO());
    setWeekday(weekdayKo(new Date()));
    setWeather("");
    setSiteName(""); setElevatorUniqueNo("");
    setTemperature(""); setHumidity(""); setApparentTemperature("");
    setEnvReadings([]);
    setEnvSaveHint("");
    setWeatherHint(""); setWeatherLocation("");
    setBaseWorkStart("08:30"); setBaseWorkEnd("17:30");
    setOvertimeStart(""); setOvertimeEnd(""); setOvertimeHours("0"); setOvertimeMinutes("0");
    setCatInspection(false); setCatFault(false); setCatRepair(false);
    setItems(Array.from({ length: 3 }, (_, i) => ({
      seq: i + 1, unit_no: "", work_category: "", work_content: "", work_start: "", work_end: "", action_result: "",
    })));
    setHeatRests(HEAT_REST_TEMPLATE.slice(0, INITIAL_HEAT_REST_ROWS).map(t => ({ ...t })));
    setSpecialNotes("");
    setWorkers([
      { name: user?.name ?? "", user_id: user?.id ?? null },
      { name: "", user_id: null },
    ]);
    workerSigRefs.current.forEach(ref => ref?.clear());
    workerSigRefs.current = [];
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError("");

    // 검증
    if (!workDate) { setError("작업일자를 입력하세요."); return; }
    if (!siteName.trim()) { setError("현장명을 입력하세요."); return; }
    // 신규 작성 시에만 작업자 최소 2인 필수 (수정 시 참가자는 편집 대상이 아님)
    if (!editingJournalId) {
      if (workers.length < 2) { setError("작업자는 최소 2인이 필요합니다."); return; }
      for (let i = 0; i < workers.length; i++) {
        if (!workers[i].name.trim()) { setError(`작업자 ${i + 1} 성명을 입력하세요.`); return; }
      }
    }

    setSaving(true);
    try {
      // 1. (신규 작성 시만) 서명 업로드
      const workerSigUrls = editingJournalId ? [] : await Promise.all(
        workers.map((_, i) => uploadSignatureRef({ current: workerSigRefs.current[i] }))
      );

      // 2. work_journals insert 또는 update
      const journalPayload = {
        work_date: workDate,
        weekday: weekday || null,
        weather: weather.trim() || null,
        site_name: siteName.trim(),
        elevator_unique_no: elevatorUniqueNo.trim(),
        temperature: temperature === "" ? null : Number(temperature),
        humidity: humidity === "" ? null : Number(humidity),
        apparent_temperature: apparentTemperature === "" ? null : Number(apparentTemperature),
        location: weatherLocation.trim() || null,
        base_work_start: baseWorkStart || null,
        base_work_end: baseWorkEnd || null,
        overtime_start: overtimeStart || null,
        overtime_end: overtimeEnd || null,
        overtime_hours: Number(overtimeHours) || 0,
        overtime_minutes: Number(overtimeMinutes) || 0,
        category_inspection: catInspection,
        category_fault: catFault,
        category_repair: catRepair,
        special_notes: specialNotes.trim(),
      };

      let journalId: number;
      if (editingJournalId) {
        const { error: updErr } = await supabase.from("work_journals")
          .update({ ...journalPayload, updated_at: new Date().toISOString() })
          .eq("id", editingJournalId);
        if (updErr) throw updErr;
        journalId = editingJournalId;
        // 부속 3개 테이블은 delete → insert 방식 (참가자는 건드리지 않음)
        await Promise.all([
          supabase.from("work_journal_items").delete().eq("journal_id", journalId),
          supabase.from("work_journal_heat_rests").delete().eq("journal_id", journalId),
          supabase.from("work_journal_env_readings").delete().eq("journal_id", journalId),
        ]);
      } else {
        const { data: rec, error: recErr } = await supabase.from("work_journals").insert({
          user_id: user.id,
          user_name: user.name,
          ...journalPayload,
        }).select("id").single();
        if (recErr) throw recErr;
        journalId = rec.id as number;
      }

      // 3. 부속 데이터 일괄 insert
      const nonEmptyItems = items.filter(it =>
        it.unit_no.trim() || it.work_category.trim() || it.work_content.trim() ||
        it.work_start || it.work_end || it.action_result.trim()
      );
      const tasks: Array<PromiseLike<{ error: { message: string } | null }>> = [];

      if (nonEmptyItems.length > 0) {
        tasks.push(supabase.from("work_journal_items").insert(
          nonEmptyItems.map(it => ({
            journal_id: journalId,
            seq: it.seq,
            unit_no: it.unit_no.trim(),
            work_category: it.work_category.trim(),
            work_content: it.work_content.trim(),
            work_start: it.work_start || null,
            work_end:   it.work_end   || null,
            action_result: it.action_result.trim(),
          }))
        ));
      }

      if (envReadings.length > 0) {
        tasks.push(supabase.from("work_journal_env_readings").insert(
          envReadings.map(r => ({
            journal_id: journalId,
            seq: r.seq,
            observed_at: r.observed_at || null,
            temperature: r.temperature === "" ? null : Number(r.temperature),
            humidity: r.humidity === "" ? null : Number(r.humidity),
            apparent_temperature: r.apparent_temperature === "" ? null : Number(r.apparent_temperature),
            location: r.location.trim() || null,
          }))
        ));
      }

      tasks.push(supabase.from("work_journal_heat_rests").insert(
        heatRests.map(r => ({
          journal_id: journalId,
          seq: r.seq,
          rest_start: r.rest_start || null,
          rest_end:   r.rest_end   || null,
          rest_method: r.rest_method.trim() || null,
        }))
      ));

      // 참가자: 신규 작성 시에만 저장 (수정 시 편집 대상 아님)
      if (!editingJournalId) {
        const participantRows = workers.map((w, i) => ({
          journal_id: journalId,
          role: `worker${i + 1}`,
          user_id: w.user_id,
          name: w.name.trim(),
          signature_url: workerSigUrls[i],
        }));
        tasks.push(supabase.from("work_journal_participants").insert(participantRows));
      }

      const results = await Promise.all(tasks);
      const insertErr = results.find(r => r.error);
      if (insertErr?.error) throw new Error(insertErr.error.message);

      // 서명하지 않은 등록 사원에게 서명 요청 알림 발송 (신규 작성 시만, 본인 제외)
      const unsignedTargets = editingJournalId ? [] : workers
        .map((w, i) => ({ w, sigUrl: workerSigUrls[i] }))
        .filter(x => !x.sigUrl && x.w.user_id && x.w.user_id !== user.id);
      if (unsignedTargets.length > 0) {
        const sitePart = siteName.trim();
        const elevPart = elevatorUniqueNo.trim() ? ` ${elevatorUniqueNo.trim()}` : "";
        (async () => {
          await Promise.all(unsignedTargets.map(x => insertNotification({
            userId:  x.w.user_id!,
            type:    "work_journal_signature_request",
            title:   "작업일지 서명이 필요합니다",
            message: `[${workDate}] ${sitePart}${elevPart} · ${user.name ?? ""} 작성 · 서명 요청`,
            link:    "/safety/work-journal",
            refType: "work_journal",
            refId:   journalId,
          })));
        })().catch(e => console.warn("[notify] 작업일지 서명 요청 알림 실패:", e));
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
      {/* 기본 정보 */}
      <div className={sectionCls}>
        <label className={labelCls}>📅 기본 정보</label>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className={labelCls}>작업일자 <span className="text-red-500">*</span></label>
            <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>요일</label>
            <input type="text" value={weekday} readOnly className={inputCls + " bg-gray-50 dark:bg-gray-800"} />
          </div>
        </div>

        <div className="mb-2">
          <label className={labelCls}>날씨</label>
          <input
            type="text" value={weather} onChange={e => setWeather(e.target.value)}
            placeholder="예: 맑음 / 흐림 / 비"
            lang="ko" className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className={labelCls}>현장명 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={siteName}
              onChange={e => setSiteName(e.target.value)}
              placeholder="현장명"
              lang="ko"
              list="wj-site-list"
              className={inputCls}
            />
            <datalist id="wj-site-list">
              {sites.map(s => <option key={s.id} value={s.name} />)}
            </datalist>
          </div>
          <div>
            <label className={labelCls}>승강기 고유번호</label>
            <input
              type="text"
              value={elevatorUniqueNo}
              onChange={e => setElevatorUniqueNo(e.target.value)}
              placeholder="예: 12345-01호기"
              lang="ko"
              list="wj-elevator-list"
              className={inputCls}
            />
            <datalist id="wj-elevator-list">
              {visibleElevators.map(e => <option key={e.id} value={e.unit_name} />)}
            </datalist>
          </div>
        </div>
      </div>

      {/* 작업 구분 */}
      <div className={sectionCls}>
        <label className={labelCls}>🔧 작업 구분 (복수 선택 가능)</label>
        <div className="grid grid-cols-3 gap-2">
          <CategoryButton label="점검(자체점검)" active={catInspection} onClick={() => setCatInspection(v => !v)} />
          <CategoryButton label="고장처리"       active={catFault}      onClick={() => setCatFault(v => !v)} />
          <CategoryButton label="수리공사"       active={catRepair}     onClick={() => setCatRepair(v => !v)} />
        </div>
      </div>

      {/* 환경 지표 */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <label className={labelCls + " mb-0"}>
            🌡️ 환경 지표 <span className="text-[11px] font-bold text-red-600 dark:text-red-400">(기상정보는 2회 이상 실시 권고)</span>
          </label>
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
        {/* 표 형태: 헤더 (온도·습도·체감온도·지역정보) + 입력 행 */}
        {(() => {
          const info = heatStressLevel(apparentTemperature === "" ? null : Number(apparentTemperature));
          const aptCellCls = info
            ? `border p-0.5 ${info.colorClass}`
            : "border border-gray-300 dark:border-gray-600 p-0.5";
          const aptInputCls = info
            ? "w-full px-2 py-1.5 text-sm text-center font-bold bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
            : "w-full px-2 py-1.5 text-sm text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded";
          const inputBaseCls = "w-full px-2 py-1.5 text-sm text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded";
          return (
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
                      <input type="number" step="0.1" value={temperature}
                        onChange={e => setTemperature(e.target.value)}
                        className={inputBaseCls} />
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                      <input type="number" step="0.1" value={humidity}
                        onChange={e => setHumidity(e.target.value)}
                        className={inputBaseCls} />
                    </td>
                    <td className={aptCellCls}>
                      <div className="flex items-center justify-center gap-1">
                        <input type="number" step="0.1" value={apparentTemperature}
                          onChange={e => setApparentTemperature(e.target.value)}
                          className={`w-16 px-1 py-1.5 text-sm text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded ${info ? "font-bold" : ""}`} />
                        {info && (
                          <span className="text-[11px] font-bold">({info.label})</span>
                        )}
                      </div>
                    </td>
                    <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                      <input type="text" value={weatherLocation}
                        onChange={e => setWeatherLocation(e.target.value)}
                        placeholder="📍 지역"
                        lang="ko"
                        className={inputBaseCls} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* 체감온도 → 온열질환 단계 안내 (환경 지표 컬럼 전체 폭) */}
        {(() => {
          const info = heatStressLevel(apparentTemperature === "" ? null : Number(apparentTemperature));
          if (!info) return null;
          const iconMap: Record<typeof info.level, string> = {
            safe:    "🟢",
            caution: "🟡",
            warning: "🟠",
            danger:  "🔴",
          };
          return (
            <div className={`mt-2 w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 ${info.colorClass}`}>
              <div className="text-2xl leading-none shrink-0">{iconMap[info.level]}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">
                  온열질환 <span className="text-base">{info.label}</span>
                  <span className="ml-2 text-xs font-normal opacity-80">
                    (체감온도 {Number(apparentTemperature).toFixed(1)}℃)
                  </span>
                </div>
                <div className="text-xs font-normal mt-0.5 opacity-90">{info.advice}</div>
              </div>
            </div>
          );
        })()}

        {/* 저장된 기상정보 로그 */}
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
                    <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">체감온도</th>
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
                          <TimeText value={r.observed_at}
                            onChange={v => updateEnvReading(idx, { observed_at: v })}
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
                            {info && (
                              <span className="text-[10px] font-bold">({info.label})</span>
                            )}
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

      {/* 근무 시간 */}
      <div className={sectionCls}>
        <label className={labelCls}>⏰ 근무 시간 <span className="text-[10px] font-normal text-gray-400">(24시간제, HH:MM 직접 입력)</span></label>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className={labelCls}>기본근무 시작</label>
            <TimeText value={baseWorkStart} onChange={setBaseWorkStart} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>기본근무 종료</label>
            <TimeText value={baseWorkEnd} onChange={setBaseWorkEnd} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label className={labelCls}>연장근무 시작</label>
            <TimeText value={overtimeStart} onChange={setOvertimeStart} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>연장근무 종료</label>
            <TimeText value={overtimeEnd} onChange={setOvertimeEnd} className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>연장 시간 <span className="text-[10px] font-normal text-gray-400">(자동)</span></label>
            <input type="number" min="0" value={overtimeHours} onChange={e => setOvertimeHours(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>연장 분 <span className="text-[10px] font-normal text-gray-400">(자동)</span></label>
            <input type="number" min="0" max="59" value={overtimeMinutes} onChange={e => setOvertimeMinutes(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {/* 호기별 작업 내역 (기본 3줄, 추가·삭제 가능) */}
      <div className={sectionCls}>
        <label className={labelCls}>📋 작업 내역</label>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700">
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-16">호기</th>
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">작업구분</th>
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">작업내용</th>
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">작업 시작</th>
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-20">작업 종료</th>
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1">조치결과 / 부품교체</th>
                <th className="border border-gray-300 dark:border-gray-600 px-2 py-1 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx}>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <input type="text" value={it.unit_no} onChange={e => updateItem(idx, { unit_no: e.target.value })}
                      lang="ko" className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <input type="text" value={it.work_category} onChange={e => updateItem(idx, { work_category: e.target.value })}
                      lang="ko" className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <input type="text" value={it.work_content} onChange={e => updateItem(idx, { work_content: e.target.value })}
                      lang="ko" className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <TimeText value={it.work_start}
                      onChange={v => updateItem(idx, { work_start: v })}
                      className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <TimeText value={it.work_end}
                      onChange={v => updateItem(idx, { work_end: v })}
                      className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <input type="text" value={it.action_result} onChange={e => updateItem(idx, { action_result: e.target.value })}
                      lang="ko" className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5 text-center">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      disabled={items.length <= 1}
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
          onClick={addItem}
          className="mt-2 w-full py-2 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-300 border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
          + 행 추가
        </button>
      </div>

      {/* 온열질환 예방 휴게 */}
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
                      onChange={v => updateRest(idx, { rest_start: v })}
                      placeholder="HH:MM"
                      className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded placeholder:text-gray-400" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <TimeText value={r.rest_end}
                      onChange={v => updateRest(idx, { rest_end: v })}
                      placeholder="HH:MM"
                      className="w-full px-1.5 py-1 text-xs text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 rounded placeholder:text-gray-400" />
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 p-0.5">
                    <input type="text" value={r.rest_method}
                      onChange={e => updateRest(idx, { rest_method: e.target.value })}
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

      {/* 특이사항 */}
      <div className={sectionCls}>
        <label className={labelCls}>📝 특이사항 (고장원인, 안전조치, 자재 사용 내역 등)</label>
        <textarea
          value={specialNotes}
          onChange={e => setSpecialNotes(e.target.value)}
          placeholder="특이사항을 자유롭게 입력하세요..."
          rows={4}
          lang="ko"
          className={inputCls + " resize-none"}
        />
      </div>

      {/* 작업 참가자 */}
      {editingJournalId ? (
        <div className={sectionCls}>
          <label className={labelCls}>👷 작업 참가자 확인</label>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            ※ 수정 모드에서는 참가자·서명을 변경할 수 없습니다. 미서명자의 개별 서명 추가는 &quot;내 작업일지&quot;에서 해당 작업일지를 펼쳐 처리하세요.
          </p>
        </div>
      ) : (
      <div className={sectionCls}>
        <label className={labelCls}>
          👷 작업 참가자 확인 <span className="text-red-600 dark:text-red-400 font-bold">(최소 2인, 서명은 필수 — 미서명자에게 알림 발송)</span>
        </label>

        {/* 작업자 목록 */}
        {workers.map((w, idx) => (
          <div key={idx} className="mb-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-gray-700 dark:text-gray-200">
                작업자 {idx + 1} <span className="text-red-500">*</span>
                {idx === 0 && (
                  <span className="ml-2 text-[10px] font-normal text-blue-600 dark:text-blue-300">(작성자 자동)</span>
                )}
              </div>
              {workers.length > 2 && (
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
                placeholder="성명"
                lang="ko"
                list={`wj-worker-list-${idx}`}
                className={inputCls}
              />
              <datalist id={`wj-worker-list-${idx}`}>
                {users.map(u => <option key={u.id} value={u.name ?? ""}>{u.dept ?? ""}</option>)}
              </datalist>
            </div>
            <label className={labelCls}>서명 <span className="text-[10px] font-normal text-red-600 dark:text-red-400">(필수 — 없으면 알림 발송)</span></label>
            <SignaturePad
              ref={el => { workerSigRefs.current[idx] = el; }}
            />
          </div>
        ))}

        {/* 작업자 추가 */}
        <button
          type="button"
          onClick={addWorker}
          className="w-full py-2 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-300 border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
          + 작업자 추가
        </button>
      </div>
      )}

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
        {saving ? "저장 중..." : editingJournalId ? "💾 수정 저장" : "📤 작업일지 저장"}
      </button>
    </form>
  );
}

function CategoryButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-3 rounded-lg border-2 text-sm font-bold transition-all ${
        active
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
          : "border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400"
      }`}
    >
      {active ? "■" : "□"} {label}
    </button>
  );
}
