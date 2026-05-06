"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, getErrorMessage } from "@/lib/api-client";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import ElevatorPicker from "@/components/common/ElevatorPicker";
import { getHolidaysForYear } from "@/lib/korean-holidays";

export interface ConstructionSchedule {
  id: number;
  requestId: number | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  siteName: string;
  elevatorName: string;
  details: string;
  workers: string;
  manager: string;
  managerPhone: string;
}

interface AnnualEvent {
  id: number;
  year: number;
  startDate: string;
  endDate: string;
  type: "연차" | "휴무" | "행사" | "기타";
  title: string;
  note: string;
}

interface SiteOption { id: number; name: string }

const EVENT_COLORS: Record<AnnualEvent["type"], string> = {
  "연차": "bg-green-500 text-white",
  "휴무": "bg-slate-500 text-white",
  "행사": "bg-blue-500 text-white",
  "기타": "bg-gray-400 text-white",
};

function CalendarContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const reqIdParam = searchParams.get("reqId");

  const [schedules, setSchedules] = useState<ConstructionSchedule[]>([]);
  const [annualEvents, setAnnualEvents] = useState<AnnualEvent[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [elevators, setElevators] = useState<{ id: number; unitName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());

  // 공사일정 모달
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [siteName, setSiteName] = useState("");
  const [elevatorName, setElevatorName] = useState("");
  const [details, setDetails] = useState("");
  const [workers, setWorkers] = useState("");
  const [manager, setManager] = useState("");
  const [managerPhone, setManagerPhone] = useState("");
  const [saving, setSaving] = useState(false);

  // 연간일정 관리 모달
  const [showAnnualModal, setShowAnnualModal] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AnnualEvent | null>(null);
  const [evStartDate, setEvStartDate] = useState("");
  const [evEndDate, setEvEndDate] = useState("");
  const [evType, setEvType] = useState<AnnualEvent["type"]>("연차");
  const [evTitle, setEvTitle] = useState("");
  const [evNote, setEvNote] = useState("");
  const [evSaving, setEvSaving] = useState(false);

  const canSchedule = user && (isAdmin(user) || hasMenuPermission(user, "/construction/schedule", "create"));

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const holidays = useMemo(() => getHolidaysForYear(year), [year]);

  useEffect(() => {
    fetchSchedules();
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  useEffect(() => {
    fetchAnnualEvents(year);
  }, [year]);

  useEffect(() => {
    if (siteName && sites.find(s => s.name === siteName)) {
      api.get<{ id: number; unitName: string }[]>(`/api/elevators?site=${encodeURIComponent(siteName)}`)
        .then(data => {
          setElevators(data);
          if (data.length === 1) {
            setElevatorName(data[0].unitName);
          } else if (data.length > 1 && !data.some(e => e.unitName === elevatorName)) {
            setElevatorName("");
          }
        })
        .catch(() => setElevators([]));
    } else {
      setElevators([]);
    }
  }, [siteName, sites]);

  useEffect(() => {
    if (reqIdParam && canSchedule) {
      setRequestId(Number(reqIdParam));
      setSiteName(searchParams.get("site") || "");
      setElevatorName(searchParams.get("elevator") || "");
      setDetails(searchParams.get("details") || "");
      setManager(searchParams.get("manager") || "");
      setManagerPhone(searchParams.get("managerPhone") || "");
      setStartDate(new Date().toISOString().slice(0, 10));
      setEndDate(new Date().toISOString().slice(0, 10));
      setShowModal(true);
    }
  }, [reqIdParam, canSchedule, searchParams]);

  async function fetchSchedules() {
    setLoading(true);
    try {
      const data = await api.get<ConstructionSchedule[]>("/api/construction-schedules");
      setSchedules(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAnnualEvents(y: number) {
    try {
      const data = await api.get<AnnualEvent[]>(`/api/annual-events?year=${y}`);
      setAnnualEvents(data);
    } catch {}
  }

  function openNewModal(dateStr?: string) {
    if (!canSchedule) return;
    setEditingId(null);
    setRequestId(null);
    setStartDate(dateStr || new Date().toISOString().slice(0, 10));
    setEndDate(dateStr || new Date().toISOString().slice(0, 10));
    setStartTime("");
    setSiteName("");
    setElevatorName("");
    setDetails("");
    setWorkers("");
    setManager("");
    setManagerPhone("");
    setShowModal(true);
  }

  function openEditModal(schedule: ConstructionSchedule) {
    if (!canSchedule) return;
    setEditingId(schedule.id);
    setRequestId(schedule.requestId);
    setStartDate(schedule.startDate);
    setEndDate(schedule.endDate);
    setStartTime(schedule.startTime || "");
    setSiteName(schedule.siteName);
    setElevatorName(schedule.elevatorName);
    setDetails(schedule.details);
    setWorkers(schedule.workers);
    setManager(schedule.manager);
    setManagerPhone(schedule.managerPhone || "");
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!siteName || !startDate || !endDate) return alert("필수 항목을 입력해주세요.");
    if (startDate > endDate) return alert("종료일이 시작일보다 빠를 수 없습니다.");

    setSaving(true);
    try {
      const payload = { requestId, startDate, endDate, startTime, siteName, elevatorName, details, workers, manager, managerPhone };
      if (editingId) {
        await api.patch(`/api/construction-schedules/${editingId}`, payload);
      } else {
        await api.post("/api/construction-schedules", payload);
      }
      setShowModal(false);
      fetchSchedules();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!confirm("정말 이 일정을 삭제하시겠습니까?")) return;
    setSaving(true);
    try {
      await api.delete(`/api/construction-schedules/${editingId}`);
      setShowModal(false);
      fetchSchedules();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function openAnnualModal() {
    setShowAnnualModal(true);
    setShowEventForm(false);
    setEditingEvent(null);
  }

  function openNewEventForm() {
    setEditingEvent(null);
    setEvStartDate(`${year}-01-01`);
    setEvEndDate(`${year}-01-01`);
    setEvType("연차");
    setEvTitle("");
    setEvNote("");
    setShowEventForm(true);
  }

  function openEditEventForm(ev: AnnualEvent) {
    setEditingEvent(ev);
    setEvStartDate(ev.startDate);
    setEvEndDate(ev.endDate);
    setEvType(ev.type);
    setEvTitle(ev.title);
    setEvNote(ev.note);
    setShowEventForm(true);
  }

  async function handleEventSave(e: React.FormEvent) {
    e.preventDefault();
    if (!evTitle || !evStartDate || !evEndDate) return;
    if (evStartDate > evEndDate) return alert("종료일이 시작일보다 빠를 수 없습니다.");
    setEvSaving(true);
    try {
      const payload = { year, startDate: evStartDate, endDate: evEndDate, type: evType, title: evTitle, note: evNote };
      if (editingEvent) {
        await api.patch(`/api/annual-events/${editingEvent.id}`, payload);
      } else {
        await api.post("/api/annual-events", payload);
      }
      setShowEventForm(false);
      setEditingEvent(null);
      await fetchAnnualEvents(year);
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setEvSaving(false);
    }
  }

  async function handleEventDelete(id: number) {
    if (!confirm("이 연간일정을 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/api/annual-events/${id}`);
      fetchAnnualEvents(year);
    } catch (e) {
      alert(getErrorMessage(e));
    }
  }

  const daysInMonth = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const result: ({ day: number; dateStr: string } | null)[] = [];
    for (let i = 0; i < firstDay; i++) result.push(null);
    for (let i = 1; i <= days; i++) {
      const dStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      result.push({ day: i, dateStr: dStr });
    }
    const remainder = result.length % 7;
    if (remainder > 0) {
      for (let i = 0; i < 7 - remainder; i++) result.push(null);
    }
    return result;
  }, [year, month]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="text-orange-500">📅</span> 공사 일정
          </h2>
          <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-2 py-1">
            <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="px-2 py-1 text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white">&lt;</button>
            <span className="font-bold w-24 text-center dark:text-white">{year}년 {month + 1}월</span>
            <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="px-2 py-1 text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white">&gt;</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canSchedule && (
            <button
              onClick={openAnnualModal}
              className="px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow hover:bg-blue-700 transition-colors"
            >
              연간일정 관리
            </button>
          )}
          {canSchedule && (
            <button
              onClick={() => openNewModal()}
              className="px-4 py-2 bg-orange-600 text-white text-sm font-semibold rounded-lg shadow hover:bg-orange-700 transition-colors"
            >
              + 일정 등록
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 relative">
        {loading && <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 flex items-center justify-center z-10"><span className="loader"></span></div>}

        <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          {["일", "월", "화", "수", "목", "금", "토"].map((day, i) => (
            <div key={day} className={`bg-gray-50 dark:bg-gray-800 py-2 text-center text-xs font-bold ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-600 dark:text-gray-300"}`}>
              {day}
            </div>
          ))}
          {daysInMonth.map((cell, idx) => {
            if (!cell) return <div key={`empty-${idx}`} className="bg-white dark:bg-gray-800 min-h-[100px]" />;
            const isSunday = idx % 7 === 0;
            const isSaturday = idx % 7 === 6;
            const holidayName = holidays.get(cell.dateStr);
            const isHoliday = !!holidayName;
            const isRed = isSunday || isHoliday;

            const daySchedules = schedules.filter(s => s.startDate <= cell.dateStr && s.endDate >= cell.dateStr);
            const dayEvents = annualEvents.filter(ev => ev.startDate <= cell.dateStr && ev.endDate >= cell.dateStr);
            const hasYeonga = dayEvents.some(ev => ev.type === "연차");

            return (
              <div
                key={cell.dateStr}
                className={`min-h-[120px] p-1 border-t border-gray-100 dark:border-gray-700 transition-colors ${hasYeonga ? "bg-red-50 dark:bg-red-900/10" : "bg-white dark:bg-gray-800"} ${canSchedule ? "hover:bg-orange-50 dark:hover:bg-orange-900/20 cursor-pointer" : ""}`}
                onClick={(e) => {
                  if (e.target === e.currentTarget) openNewModal(cell.dateStr);
                }}
              >
                <div className={`flex items-baseline gap-1 px-1 py-0.5 ${isRed || hasYeonga ? "text-red-500" : isSaturday ? "text-blue-500" : "text-gray-700 dark:text-gray-300"}`}>
                  <span className="text-xs font-semibold">{cell.day}</span>
                  {holidayName && (
                    <span className="text-[10px] font-normal text-red-400 dark:text-red-300 leading-none truncate">{holidayName}</span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {dayEvents.map(ev => (
                    <div
                      key={`ev-${ev.id}`}
                      className={`text-[11px] px-1.5 py-0.5 rounded leading-tight truncate ${EVENT_COLORS[ev.type]}`}
                      title={`${ev.type}: ${ev.title}${ev.note ? ` · ${ev.note}` : ""}`}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {daySchedules.map(sch => (
                    <div
                      key={`sch-${sch.id}`}
                      onClick={(e) => { e.stopPropagation(); openEditModal(sch); }}
                      className="text-xs px-2 py-1.5 rounded cursor-pointer leading-tight flex flex-col gap-0.5 shadow-sm bg-orange-100 dark:bg-orange-900/50 border border-orange-300 dark:border-orange-700 text-gray-900 dark:text-white"
                      title={`${sch.siteName} ${sch.elevatorName ? `(${sch.elevatorName})` : ""}${sch.startTime ? ` ${sch.startTime}` : ""} / ${sch.details} / ${sch.workers}${sch.manager ? ` / 담당: ${sch.manager}${sch.managerPhone ? ` ${sch.managerPhone}` : ""}` : ""}`}
                    >
                      <div className="font-bold truncate text-[12px]">
                        {sch.siteName}{sch.elevatorName ? ` · ${sch.elevatorName}` : ""}
                      </div>
                      {sch.startTime && (
                        <div className="truncate text-[11px] font-medium">{sch.startTime}</div>
                      )}
                      {sch.details && (
                        <div className="truncate text-[11px] opacity-80">{sch.details}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 공사일정 등록/수정 모달 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{editingId ? "공사 일정 수정" : "공사 일정 등록"}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
              {requestId && !editingId && (
                <div className="bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 p-3 rounded-lg text-sm mb-2">
                  ℹ️ 선택하신 공사요청 정보를 기반으로 일정을 등록합니다.
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">시작일 <span className="text-red-500">*</span></label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">종료일 <span className="text-red-500">*</span></label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">작업시작시간</label>
                  <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">현장명 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={siteName}
                    onChange={e => setSiteName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && siteName.trim()) {
                        const matched = sites.filter(s => s.name.toLowerCase().includes(siteName.toLowerCase()));
                        if (matched.length === 1) {
                          e.preventDefault();
                          setSiteName(matched[0].name);
                          e.currentTarget.blur();
                        }
                      }
                    }}
                    required
                    list="sites-list"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <datalist id="sites-list">{sites.map(s => <option key={s.id} value={s.name} />)}</datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">호기</label>
                  {elevators.length > 0 ? (
                    <ElevatorPicker value={elevatorName ?? ""} elevators={elevators}
                      onChange={setElevatorName} placeholder="호기 선택 (생략 가능)" inline={false} />
                  ) : (
                    <input
                      type="text"
                      value={elevatorName}
                      onChange={e => setElevatorName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">담당자</label>
                  <input type="text" value={manager} onChange={e => setManager(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">담당자 연락처</label>
                  <input type="tel" value={managerPhone} onChange={e => setManagerPhone(e.target.value)} placeholder="예: 010-1234-5678" lang="ko" inputMode="tel" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">작업자</label>
                <input type="text" value={workers} onChange={e => setWorkers(e.target.value)} placeholder="예: 홍길동 외 1명" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">공사 내용</label>
                <textarea value={details} onChange={e => setDetails(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none" />
              </div>
              <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setSiteName("공사휴무")} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors">
                    공사휴무
                  </button>
                  {editingId && (
                    <button type="button" onClick={handleDelete} disabled={saving} className="text-red-500 hover:text-red-700 text-sm font-medium px-2 py-1">삭제</button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600">취소</button>
                  <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded hover:bg-orange-700 disabled:opacity-50">저장</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 연간일정 관리 모달 */}
      {showAnnualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">연간일정 관리</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{year}년 단체연차 · 휴무 · 행사 등</p>
              </div>
              <button onClick={() => setShowAnnualModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!showEventForm ? (
                <div className="p-5 flex flex-col gap-3">
                  <button
                    onClick={openNewEventForm}
                    className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    + 새 연간일정 추가
                  </button>

                  {/* 범례 */}
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    {(["연차", "휴무", "행사", "기타"] as const).map(t => (
                      <span key={t} className={`px-2 py-0.5 rounded ${EVENT_COLORS[t]}`}>{t}</span>
                    ))}
                  </div>

                  {annualEvents.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{year}년 등록된 연간일정이 없습니다.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {[...annualEvents].sort((a, b) => a.startDate.localeCompare(b.startDate)).map(ev => (
                        <div key={ev.id} className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <span className={`shrink-0 px-2 py-0.5 text-xs rounded font-semibold ${EVENT_COLORS[ev.type]}`}>{ev.type}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-800 dark:text-gray-100 truncate">{ev.title}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {ev.startDate === ev.endDate ? ev.startDate : `${ev.startDate} ~ ${ev.endDate}`}
                              {ev.note ? ` · ${ev.note}` : ""}
                            </div>
                          </div>
                          <button onClick={() => openEditEventForm(ev)} className="shrink-0 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">수정</button>
                          <button onClick={() => handleEventDelete(ev.id)} className="shrink-0 text-sm text-red-500 hover:text-red-700">삭제</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleEventSave} className="p-5 flex flex-col gap-4">
                  <h4 className="font-semibold text-gray-800 dark:text-gray-100">{editingEvent ? "연간일정 수정" : "새 연간일정 추가"}</h4>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">구분 <span className="text-red-500">*</span></label>
                    <select
                      value={evType}
                      onChange={e => setEvType(e.target.value as AnnualEvent["type"])}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      {(["연차", "휴무", "행사", "기타"] as const).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">제목 <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={evTitle}
                      onChange={e => setEvTitle(e.target.value)}
                      required
                      placeholder="예: 단체연차, 하계휴무, 창립기념일"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">시작일 <span className="text-red-500">*</span></label>
                      <input type="date" value={evStartDate} onChange={e => setEvStartDate(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">종료일 <span className="text-red-500">*</span></label>
                      <input type="date" value={evEndDate} onChange={e => setEvEndDate(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">메모</label>
                    <input
                      type="text"
                      value={evNote}
                      onChange={e => setEvNote(e.target.value)}
                      placeholder="선택 입력"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="flex justify-between pt-2">
                    <button type="button" onClick={() => setShowEventForm(false)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
                      뒤로
                    </button>
                    <button type="submit" disabled={evSaving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">
                      {evSaving ? "저장 중..." : "저장"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConstructionCalendarWrapper() {
  return (
    <Suspense fallback={<div className="p-10 flex justify-center"><span className="loader"></span></div>}>
      <CalendarContent />
    </Suspense>
  );
}
