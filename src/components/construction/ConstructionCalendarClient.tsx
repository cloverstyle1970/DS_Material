"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, getErrorMessage } from "@/lib/api-client";
import { useAuth, isAdmin } from "@/context/AuthContext";

export interface ConstructionSchedule {
  id: number;
  requestId: number | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  siteName: string;
  elevatorName: string;
  details: string;
  workers: string;
  manager: string;
}

interface SiteOption { id: number; name: string }

function CalendarContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const reqIdParam = searchParams.get("reqId");
  
  const [schedules, setSchedules] = useState<ConstructionSchedule[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [siteName, setSiteName] = useState("");
  const [elevatorName, setElevatorName] = useState("");
  const [details, setDetails] = useState("");
  const [workers, setWorkers] = useState("");
  const [manager, setManager] = useState("");
  const [saving, setSaving] = useState(false);

  // 권한 체크
  const canSchedule = user && (isAdmin(user) || user.name === "송영권" || user.name === "이종선");

  useEffect(() => {
    fetchSchedules();
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  useEffect(() => {
    if (reqIdParam && canSchedule) {
      setRequestId(Number(reqIdParam));
      setSiteName(searchParams.get("site") || "");
      setElevatorName(searchParams.get("elevator") || "");
      setDetails(searchParams.get("details") || "");
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

  function openNewModal(dateStr?: string) {
    if (!canSchedule) return;
    setEditingId(null);
    setRequestId(null);
    setStartDate(dateStr || new Date().toISOString().slice(0, 10));
    setEndDate(dateStr || new Date().toISOString().slice(0, 10));
    setSiteName("");
    setElevatorName("");
    setDetails("");
    setWorkers("");
    setManager("");
    setShowModal(true);
  }

  function openEditModal(schedule: ConstructionSchedule) {
    if (!canSchedule) return;
    setEditingId(schedule.id);
    setRequestId(schedule.requestId);
    setStartDate(schedule.startDate);
    setEndDate(schedule.endDate);
    setSiteName(schedule.siteName);
    setElevatorName(schedule.elevatorName);
    setDetails(schedule.details);
    setWorkers(schedule.workers);
    setManager(schedule.manager);
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!siteName || !startDate || !endDate) return alert("필수 항목을 입력해주세요.");
    if (startDate > endDate) return alert("종료일이 시작일보다 빠를 수 없습니다.");
    
    setSaving(true);
    try {
      const payload = { requestId, startDate, endDate, siteName, elevatorName, details, workers, manager };
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

  // 달력 계산 로직
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  const daysInMonth = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const result = [];
    for (let i = 0; i < firstDay; i++) result.push(null);
    for (let i = 1; i <= days; i++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
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
        {canSchedule && (
          <button
            onClick={() => openNewModal()}
            className="px-4 py-2 bg-orange-600 text-white text-sm font-semibold rounded-lg shadow hover:bg-orange-700 transition-colors"
          >
            + 일정 등록
          </button>
        )}
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
            
            // 현재 날짜에 걸쳐있는 일정 필터링
            const daySchedules = schedules.filter(s => s.startDate <= cell.dateStr && s.endDate >= cell.dateStr);

            return (
              <div 
                key={cell.dateStr} 
                className={`bg-white dark:bg-gray-800 min-h-[120px] p-1 border-t border-gray-100 dark:border-gray-700 transition-colors ${canSchedule ? "hover:bg-orange-50 dark:hover:bg-orange-900/20 cursor-pointer" : ""}`}
                onClick={(e) => {
                  if (e.target === e.currentTarget) openNewModal(cell.dateStr);
                }}
              >
                <div className={`text-xs font-semibold p-1 ${isSunday ? "text-red-500" : isSaturday ? "text-blue-500" : "text-gray-700 dark:text-gray-300"}`}>
                  {cell.day}
                </div>
                <div className="flex flex-col gap-1 mt-1">
                  {daySchedules.map(sch => (
                    <div 
                      key={sch.id} 
                      onClick={(e) => { e.stopPropagation(); openEditModal(sch); }}
                      className={`text-xs px-2 py-1.5 rounded cursor-pointer leading-tight flex flex-col gap-1 shadow-sm ${sch.endDate > sch.startDate ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100"}`}
                      title={`${sch.siteName} ${sch.elevatorName ? `(${sch.elevatorName})` : ""} / ${sch.details} / ${sch.workers}`}
                    >
                      <div className="font-bold truncate text-[13px]">{sch.siteName}{sch.elevatorName ? ` ${sch.elevatorName}` : ""}</div>
                      <div className="truncate opacity-95">{sch.details}</div>
                      {sch.workers && <div className="truncate opacity-80 text-[11px] mt-0.5">{sch.workers}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">시작일 <span className="text-red-500">*</span></label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">종료일 <span className="text-red-500">*</span></label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">현장명 <span className="text-red-500">*</span></label>
                  <input type="text" value={siteName} onChange={e => setSiteName(e.target.value)} required list="sites-list" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                  <datalist id="sites-list">{sites.map(s => <option key={s.id} value={s.name} />)}</datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">호기</label>
                  <input type="text" value={elevatorName} onChange={e => setElevatorName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">작업자</label>
                  <input type="text" value={workers} onChange={e => setWorkers(e.target.value)} placeholder="예: 홍길동 외 1명" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">담당자</label>
                  <input type="text" value={manager} onChange={e => setManager(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                </div>
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
