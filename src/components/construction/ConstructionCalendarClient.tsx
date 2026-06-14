"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, getErrorMessage } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { useAuth, isAdmin, hasMenuPermission } from "@/context/AuthContext";
import ElevatorPicker from "@/components/common/ElevatorPicker";
import DraggableModal from "@/components/common/DraggableModal";
import { useViewMode } from "@/context/ViewModeContext";
import { getHolidaysForYear } from "@/lib/korean-holidays";
import { formatPhone } from "@/lib/input-format";

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
  companyType: "TK" | "DS" | "" | null;
  progressConfirmed: boolean; // 기성확인
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
  const [tbmScheduleIds, setTbmScheduleIds] = useState<Set<number>>(new Set());
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [elevators, setElevators] = useState<{ id: number; unitName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calMode, setCalMode] = useState<"month" | "week">("month"); // 월간/주간 보기
  const [companyFilter, setCompanyFilter] = useState<"ALL" | "TK" | "DS">("ALL");

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
  const [companyType, setCompanyType] = useState<"TK" | "DS" | "">("");
  const [progressConfirmed, setProgressConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  // 현장명 검색 (인라인)
  const [siteSearchInput, setSiteSearchInput] = useState("");
  const [siteSearchKeyword, setSiteSearchKeyword] = useState("");

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

  // 모바일: 화면 모드(viewMode='mobile') 또는 실제 좁은 화면(<768px) 둘 중 하나면 모바일 UI
  const { viewMode } = useViewMode();
  const [narrowScreen, setNarrowScreen] = useState(false);
  const [viewSchedule, setViewSchedule] = useState<ConstructionSchedule | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrowScreen(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const isMobile = viewMode === "mobile" || narrowScreen;

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
      // TBM이 작성된 schedule_id 집합 로드
      const { data: tbmRows } = await supabase.from("tbm_records")
        .select("schedule_id")
        .not("schedule_id", "is", null);
      setTbmScheduleIds(new Set(((tbmRows ?? []) as { schedule_id: number }[]).map(r => r.schedule_id)));
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
    setCompanyType("");
    setProgressConfirmed(false);
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
    setCompanyType(schedule.companyType === "TK" || schedule.companyType === "DS" ? schedule.companyType : "");
    setProgressConfirmed(!!schedule.progressConfirmed);
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!siteName || !startDate || !endDate) return alert("필수 항목을 입력해주세요.");
    if (startDate > endDate) return alert("종료일이 시작일보다 빠를 수 없습니다.");

    setSaving(true);
    try {
      const payload = { requestId, startDate, endDate, startTime, siteName, elevatorName, details, workers, manager, managerPhone, companyType, progressConfirmed };
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
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    setEvStartDate(todayStr);
    setEvEndDate(todayStr);
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

  // 주간 보기: currentDate가 속한 주(일~토) 7일
  const weekCells = useMemo(() => {
    const sunday = new Date(currentDate);
    sunday.setDate(currentDate.getDate() - currentDate.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { day: d.getDate(), dateStr: dStr };
    });
  }, [currentDate]);

  // 현재 보기 모드에 따른 셀 배열 (월간: null 포함 / 주간: 7일)
  const cells: ({ day: number; dateStr: string } | null)[] = calMode === "week" ? weekCells : daysInMonth;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className={`p-4 border-b border-gray-200 dark:border-gray-700 gap-2 ${isMobile ? "flex flex-col items-stretch" : "flex items-center justify-between"}`}>
        <div className={`flex items-center gap-4 ${isMobile ? "flex-wrap gap-2" : ""}`}>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="text-orange-500">📅</span> 공사 일정
          </h2>
          <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-2 py-1">
            <button onClick={() => setCurrentDate(d => {
              if (calMode === "week") { const n = new Date(d); n.setDate(d.getDate() - 7); return n; }
              return new Date(d.getFullYear(), d.getMonth() - 1, 1);
            })} className="px-2 py-1 text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white">&lt;</button>
            <span className="font-bold w-28 text-center text-gray-900 dark:text-white text-sm">
              {calMode === "week"
                ? `${weekCells[0].dateStr.slice(5).replace("-", "/")} ~ ${weekCells[6].dateStr.slice(5).replace("-", "/")}`
                : `${year}년 ${month + 1}월`}
            </span>
            <button onClick={() => setCurrentDate(d => {
              if (calMode === "week") { const n = new Date(d); n.setDate(d.getDate() + 7); return n; }
              return new Date(d.getFullYear(), d.getMonth() + 1, 1);
            })} className="px-2 py-1 text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white">&gt;</button>
          </div>
          {/* 월간 / 주간 보기 토글 */}
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
            {(["month", "week"] as const).map(m => (
              <button key={m} type="button" onClick={() => setCalMode(m)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  calMode === m ? "bg-slate-600 text-white" : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                }`}>
                {m === "month" ? "월" : "주"}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
            {(["ALL", "TK", "DS"] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setCompanyFilter(f)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  companyFilter === f
                    ? f === "TK" ? "bg-blue-600 text-white"
                      : f === "DS" ? "bg-red-500 text-white"
                      : "bg-slate-600 text-white"
                    : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                }`}
              >
                {f === "ALL" ? "전체" : f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={siteSearchInput}
              onChange={e => setSiteSearchInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setSiteSearchKeyword(siteSearchInput.trim());
                }
              }}
              list="header-sites-list"
              placeholder="현장명 검색 (예: 파크)"
              className="w-40 px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <datalist id="header-sites-list">{sites.map(s => <option key={s.id} value={s.name} />)}</datalist>
            <button
              type="button"
              onClick={() => setSiteSearchKeyword(siteSearchInput.trim())}
              className="px-3 py-1.5 bg-slate-600 text-white text-xs font-semibold rounded hover:bg-slate-700 transition-colors"
            >
              검색
            </button>
            {siteSearchKeyword && (
              <button
                type="button"
                onClick={() => { setSiteSearchInput(""); setSiteSearchKeyword(""); }}
                className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-300 hover:text-red-500"
                title="검색 초기화"
              >
                ✕
              </button>
            )}
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

        <div className={`grid ${calMode === "week" ? "grid-cols-1" : "grid-cols-7"} gap-px bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden`}>
          {calMode === "month" && ["일", "월", "화", "수", "목", "금", "토"].map((day, i) => (
            <div key={day} className={`bg-gray-50 dark:bg-gray-800 py-2 text-center text-xs font-bold ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-gray-600 dark:text-gray-300"}`}>
              {day}
            </div>
          ))}
          {cells.map((cell, idx) => {
            if (!cell) return <div key={`empty-${idx}`} className={`bg-white dark:bg-gray-800 ${isMobile ? "min-h-[56px]" : "min-h-[100px]"}`} />;
            const isSunday = idx % 7 === 0;
            const isSaturday = idx % 7 === 6;
            const holidayName = holidays.get(cell.dateStr);
            const isHoliday = !!holidayName;
            const isRed = isSunday || isHoliday;

            const daySchedules = schedules.filter(s => {
              if (s.startDate > cell.dateStr || s.endDate < cell.dateStr) return false;
              if (siteSearchKeyword && !s.siteName.toLowerCase().includes(siteSearchKeyword.toLowerCase())) return false;
              if (companyFilter === "ALL") return true;
              if (s.siteName === "공사휴무") return true;
              return s.companyType === companyFilter;
            });
            const dayEvents = annualEvents.filter(ev => ev.startDate <= cell.dateStr && ev.endDate >= cell.dateStr);
            const hasYeonga = dayEvents.some(ev => ev.type === "연차");

            return (
              <div
                key={cell.dateStr}
                className={`${calMode === "week" ? "min-h-[72px]" : isMobile ? "min-h-[56px]" : "min-h-[120px]"} p-1 border-t border-gray-100 dark:border-gray-700 transition-colors ${hasYeonga ? "bg-red-50 dark:bg-red-900/10" : "bg-white dark:bg-gray-800"} ${canSchedule ? "hover:bg-orange-50 dark:hover:bg-orange-900/20 cursor-pointer" : ""}`}
                onClick={(e) => {
                  if (e.target === e.currentTarget) openNewModal(cell.dateStr);
                }}
              >
                <div className={`flex items-baseline gap-1 px-1 py-0.5 ${isRed || hasYeonga ? "text-red-500" : isSaturday ? "text-blue-500" : "text-gray-700 dark:text-gray-300"}`}>
                  {calMode === "week" && <span className="text-xs font-bold mr-1">{["일", "월", "화", "수", "목", "금", "토"][idx % 7]}요일</span>}
                  <span className="text-xs font-semibold">{cell.day}</span>
                  {holidayName && (
                    <span className="text-xs font-bold leading-none truncate">{holidayName}</span>
                  )}
                </div>
                <div className={`gap-0.5 mt-0.5 flex ${calMode === "week" ? "flex-row flex-wrap items-start" : "flex-col"}`}>
                  {dayEvents.map(ev => (
                    <div
                      key={`ev-${ev.id}`}
                      className={`text-xs font-bold px-1.5 py-1 rounded leading-tight truncate ${EVENT_COLORS[ev.type]}`}
                      title={`${ev.type}: ${ev.title}${ev.note ? ` · ${ev.note}` : ""}`}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {daySchedules.map(sch => {
                    const hasTbm = tbmScheduleIds.has(sch.id);
                    // 공사휴무는 기존 색감 유지 (휴무는 TBM 대상 아님)
                    const isHoliday = sch.siteName === "공사휴무";
                    const isTk = sch.companyType === "TK";
                    const isPaid = !!sch.progressConfirmed;
                    // 기성확인이 우선: 테두리·텍스트 모두 빨간색으로 강조
                    const borderCls = isPaid
                      ? "border-red-500 dark:border-red-400"
                      : isHoliday
                        ? "border-green-300 dark:border-green-400"
                        : isTk
                          ? "border-blue-500 dark:border-blue-400"     // TK 현장: 파란색
                          : hasTbm
                            ? "border-blue-500 dark:border-white"      // TBM 작성됨
                            : "border-black dark:border-white";        // TBM 미작성
                    const baseTextCls = isPaid
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-900 dark:text-gray-100";
                    const titleTextCls = isPaid
                      ? "text-red-600 dark:text-red-400"
                      : isTk ? "text-blue-600 dark:text-blue-400" : "";
                    const subTextCls = isPaid
                      ? "text-red-600 dark:text-red-400"
                      : "text-gray-700 dark:text-white";
                    return (
                      <div
                        key={`sch-${sch.id}`}
                        onClick={(e) => { e.stopPropagation(); if (isMobile) setViewSchedule(sch); else openEditModal(sch); }}
                        className={`text-xs rounded cursor-pointer leading-tight flex flex-col gap-0.5 bg-transparent ${isMobile ? "px-1 py-0.5 border" : "px-2 py-1.5 border-2"} ${baseTextCls} ${borderCls}`}
                        title={`${sch.siteName} ${sch.elevatorName ? `(${sch.elevatorName})` : ""}${sch.startTime ? ` ${sch.startTime}` : ""} / ${sch.details} / ${sch.workers}${sch.manager ? ` / 담당: ${sch.manager}${sch.managerPhone ? ` ${sch.managerPhone}` : ""}` : ""}${!isHoliday ? (hasTbm ? " · TBM 작성됨" : " · TBM 미작성") : ""}${isPaid ? " · 기성확인" : ""}`}
                      >
                        <div className={`font-bold truncate text-[12px] ${titleTextCls}`}>
                          {sch.siteName}{sch.elevatorName ? ` · ${sch.elevatorName}` : ""}
                        </div>
                        {!isMobile && sch.startTime && (
                          <div className="truncate text-[11px] font-medium">{sch.startTime}</div>
                        )}
                        {!isMobile && sch.details && (
                          <div className={`truncate text-[11px] ${subTextCls}`}>{sch.details}</div>
                        )}
                        {!isMobile && sch.workers && (
                          <div className={`truncate text-[11px] ${subTextCls}`}>👷 {sch.workers}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 공사일정 등록/수정 모달 */}
      <DraggableModal
        open={showModal}
        panelClassName="w-full max-w-lg"
        header={
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{editingId ? "공사 일정 수정" : "공사 일정 등록"}</h3>
            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
          </div>
        }
      >
        <form onSubmit={handleSubmit} className={`p-5 flex flex-col gap-4 ${isMobile ? "force-mobile" : ""}`}>
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">작업시작시간 (24h)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={startTime}
                    onChange={e => {
                      // 숫자만 추출 후 자동 포맷: 0830 → 08:30
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                      const formatted = digits.length <= 2 ? digits : digits.slice(0, 2) + ":" + digits.slice(2);
                      setStartTime(formatted);
                    }}
                    placeholder="HHMM (예: 0830 → 08:30)"
                    pattern="^([01]\d|2[0-3]):[0-5]\d$"
                    title="24시간 형식 HHMM 입력 시 자동으로 HH:MM (예: 0830 → 08:30)"
                    maxLength={5}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">현장구분</label>
                  <div className="flex rounded overflow-hidden border border-gray-300 dark:border-gray-600">
                    {(["", "TK", "DS"] as const).map(t => (
                      <button key={t || "none"} type="button" onClick={() => setCompanyType(t)}
                        className={`px-3 py-2 text-sm font-semibold transition-colors ${
                          companyType === t
                            ? t === "TK" ? "bg-blue-600 text-white"
                              : t === "DS" ? "bg-red-500 text-white"
                              : "bg-slate-600 text-white"
                            : "bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        }`}>
                        {t || "—"}
                      </button>
                    ))}
                  </div>
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
                  <input type="tel" value={managerPhone} onChange={e => setManagerPhone(formatPhone(e.target.value))} placeholder="010-0000-0000 또는 02-000-0000" inputMode="tel" maxLength={14} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">작업자</label>
                <input type="text" value={workers} onChange={e => setWorkers(e.target.value)} placeholder="예: 홍길동 외 1명" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">공사내용 및 전달사항</label>
                <textarea value={details} onChange={e => setDetails(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none" />
              </div>
              <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setSiteName("공사휴무")} className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors">
                    공사휴무
                  </button>
                  <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded border-2 cursor-pointer transition-colors ${
                    progressConfirmed
                      ? "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                      : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}>
                    <input type="checkbox" checked={progressConfirmed}
                      onChange={e => setProgressConfirmed(e.target.checked)}
                      className="rounded accent-red-500" />
                    <span className="text-sm font-semibold">기성확인</span>
                  </label>
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
      </DraggableModal>

      {/* 연간일정 관리 모달 */}
      <DraggableModal
        open={showAnnualModal}
        panelClassName="w-full max-w-lg max-h-[90vh]"
        header={
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">연간일정 관리</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{year}년 단체연차 · 휴무 · 행사 등</p>
            </div>
            <button onClick={() => setShowAnnualModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
          </div>
        }
      >
        <div className={`flex-1 overflow-y-auto ${isMobile ? "force-mobile" : ""}`}>
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
                      <input type="date" value={evStartDate} onChange={e => {
                        const v = e.target.value;
                        setEvStartDate(v);
                        if (!evEndDate || evEndDate < v) setEvEndDate(v);
                      }} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
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
                      취소
                    </button>
                    <button type="submit" disabled={evSaving} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">
                      {evSaving ? "저장 중..." : "저장"}
                    </button>
                  </div>
                </form>
              )}
            </div>
      </DraggableModal>

      {/* 모바일 전용: 공사 일정 내용 보기 팝업 */}
      {viewSchedule && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
          onClick={() => setViewSchedule(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0">
              <div className="min-w-0 flex items-center gap-2">
                {viewSchedule.companyType === "TK"
                  ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-600 dark:bg-blue-900/60 dark:text-blue-300 shrink-0">TK</span>
                  : viewSchedule.companyType === "DS"
                    ? <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600 dark:bg-red-900/60 dark:text-red-300 shrink-0">DS</span>
                    : null}
                <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">
                  {viewSchedule.siteName}{viewSchedule.elevatorName ? ` · ${viewSchedule.elevatorName}` : ""}
                </h3>
              </div>
              <button type="button" onClick={() => setViewSchedule(null)}
                aria-label="닫기"
                className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none ml-3">×</button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <dl className="divide-y divide-gray-100 dark:divide-gray-700 text-sm">
                {[
                  { label: "기간", value: viewSchedule.startDate === viewSchedule.endDate ? viewSchedule.startDate : `${viewSchedule.startDate} ~ ${viewSchedule.endDate}` },
                  ...(viewSchedule.startTime ? [{ label: "작업시작", value: viewSchedule.startTime }] : []),
                  { label: "현장명", value: viewSchedule.siteName },
                  { label: "호기", value: viewSchedule.elevatorName || "-" },
                  { label: "담당자", value: viewSchedule.manager || "-" },
                  { label: "연락처", value: viewSchedule.managerPhone || "-", mono: true },
                  { label: "작업자", value: viewSchedule.workers || "-" },
                  { label: "기성확인", value: viewSchedule.progressConfirmed ? "확인" : "미확인" },
                  ...(viewSchedule.siteName !== "공사휴무" ? [{ label: "TBM", value: tbmScheduleIds.has(viewSchedule.id) ? "작성됨" : "미작성" }] : []),
                ].map(row => (
                  <div key={row.label} className="flex items-start justify-between gap-3 py-2.5">
                    <dt className="text-gray-500 dark:text-gray-400 shrink-0">{row.label}</dt>
                    <dd className={`text-right font-medium text-gray-800 dark:text-gray-100 break-all ${"mono" in row && row.mono ? "font-mono" : ""}`}>{row.value}</dd>
                  </div>
                ))}
              </dl>
              {viewSchedule.details && (
                <div className="mt-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">공사내용 및 전달사항</p>
                  <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3">{viewSchedule.details}</p>
                </div>
              )}
            </div>
            {canSchedule && (
              <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2 shrink-0">
                <button type="button"
                  onClick={() => { const s = viewSchedule; setViewSchedule(null); openEditModal(s); }}
                  className="px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-bold hover:bg-orange-700">
                  수정
                </button>
              </div>
            )}
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
