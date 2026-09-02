"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

interface Holiday {
  id: number;
  date: string;
  name: string;
}

// 날짜 고정 법정공휴일 (매년 동일)
const FIXED_STATUTORY: { month: number; day: number; name: string }[] = [
  { month: 1,  day: 1,  name: "신정" },
  { month: 3,  day: 1,  name: "삼일절" },
  { month: 5,  day: 5,  name: "어린이날" },
  { month: 6,  day: 6,  name: "현충일" },
  { month: 8,  day: 15, name: "광복절" },
  { month: 10, day: 3,  name: "개천절" },
  { month: 10, day: 9,  name: "한글날" },
  { month: 12, day: 25, name: "성탄절" },
];

// 음력 기준 이동 법정공휴일
const LUNAR_STATUTORY: { name: string; desc: string }[] = [
  { name: "설날 연휴·설날·설날 연휴", desc: "음력 1월 1일 전·당일·다음날 (3일)" },
  { name: "부처님오신날",              desc: "음력 4월 8일" },
  { name: "추석 연휴·추석·추석 연휴", desc: "음력 8월 15일 전·당일·다음날 (3일)" },
];

function pad2(n: number) { return String(n).padStart(2, "0"); }

function formatDate(date: string) {
  const [y, m, d] = date.split("-");
  return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
}

function dayOfWeek(date: string) {
  const d = new Date(date + "T00:00:00");
  return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
}

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 1 + i);

export default function PublicHolidaysClient() {
  const { user } = useAuth();
  const admin = user ? isAdmin(user) : false;

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [statutoryOpen, setStatutoryOpen] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addName, setAddName] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("public_holidays")
      .select("id,date,name")
      .gte("date", `${selectedYear}-01-01`)
      .lte("date", `${selectedYear}-12-31`)
      .order("date");
    if (error) {
      alert("공휴일 로드 실패: " + error.message);
      setLoading(false);
      return;
    }
    setHolidays((data as Holiday[] | null) ?? []);
    setLoading(false);
  }, [selectedYear]);

  useEffect(() => { load(); }, [load]);

  const registeredDates = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);

  // 선택 연도 기준 고정 법정공휴일 목록
  const fixedStatutoryForYear = useMemo(() =>
    FIXED_STATUTORY.map(h => ({
      ...h,
      date: `${selectedYear}-${pad2(h.month)}-${pad2(h.day)}`,
    })),
  [selectedYear]);

  const missingFixed = useMemo(() =>
    fixedStatutoryForYear.filter(h => !registeredDates.has(h.date)),
  [fixedStatutoryForYear, registeredDates]);

  const grouped = useMemo(() => {
    const map: Record<string, Holiday[]> = {};
    holidays.forEach(h => {
      const m = h.date.slice(0, 7);
      (map[m] ??= []).push(h);
    });
    return map;
  }, [holidays]);

  async function addHoliday() {
    if (!addDate) { alert("날짜를 선택해주세요."); return; }
    if (!addName.trim()) { alert("공휴일명을 입력해주세요."); return; }
    setAddSaving(true);
    const { error } = await supabase.from("public_holidays")
      .insert({ date: addDate, name: addName.trim() });
    setAddSaving(false);
    if (error) { alert("추가 실패: " + error.message); return; }
    setAddOpen(false); setAddDate(""); setAddName("");
    // 입력 날짜 연도가 현재 선택 연도와 다르면 해당 연도로 전환 (useEffect가 load 자동 호출)
    const addedYear = parseInt(addDate.slice(0, 4));
    if (addedYear !== selectedYear) {
      setSelectedYear(addedYear);
    } else {
      await load();
    }
  }

  async function addSingleFixed(date: string, name: string) {
    const { error } = await supabase.from("public_holidays")
      .insert({ date, name });
    if (error) { alert("추가 실패: " + error.message); return; }
    await load();
  }

  async function bulkAddFixed() {
    if (missingFixed.length === 0) return;
    setBulkSaving(true);
    const { error } = await supabase.from("public_holidays")
      .insert(missingFixed.map(h => ({ date: h.date, name: h.name })));
    setBulkSaving(false);
    if (error) { alert("일괄 등록 실패: " + error.message); return; }
    await load();
  }

  async function saveEdit(id: number) {
    if (!editName.trim()) { alert("공휴일명을 입력해주세요."); return; }
    setEditSaving(true);
    const { error } = await supabase.from("public_holidays")
      .update({ name: editName.trim() }).eq("id", id);
    setEditSaving(false);
    if (error) { alert("수정 실패: " + error.message); return; }
    setEditId(null);
    await load();
  }

  async function deleteHoliday(id: number, name: string) {
    if (!confirm(`"${name}"을(를) 삭제하시겠습니까?`)) return;
    const { error } = await supabase.from("public_holidays").delete().eq("id", id);
    if (error) { alert("삭제 실패: " + error.message); return; }
    await load();
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 text-sm">
      {/* 상단 툴바 */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100">공휴일 관리</h1>
          <div className="flex gap-1">
            {YEARS.map(y => (
              <button key={y} onClick={() => setSelectedYear(y)}
                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                  selectedYear === y
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}>
                {y}
              </button>
            ))}
          </div>
        </div>
        {admin && (
          <button onClick={() => { setAddOpen(true); setAddDate(`${selectedYear}-01-01`); setAddName(""); }}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">
            + 공휴일 추가
          </button>
        )}
      </div>

      {/* 추가 폼 */}
      {addOpen && admin && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 text-xs">
          <span className="font-medium text-blue-800 dark:text-blue-300 whitespace-nowrap">새 공휴일</span>
          <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-400" />
          <input value={addName} onChange={e => setAddName(e.target.value)}
            placeholder="공휴일명 (예: 설날)"
            className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-400 w-48"
            onKeyDown={e => { if (e.key === "Enter") addHoliday(); }}
          />
          <button onClick={addHoliday} disabled={addSaving}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50">
            {addSaving ? "추가중…" : "추가"}
          </button>
          <button onClick={() => setAddOpen(false)}
            className="px-3 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded">
            취소
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-4">

        {/* ── 법정공휴일 기준 패널 ── */}
        <div className="max-w-2xl bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => setStatutoryOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-left">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">📋 대한민국 법정공휴일 기준</span>
              <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">관공서의 공휴일에 관한 규정</span>
            </div>
            <span className="text-xs text-amber-500">{statutoryOpen ? "▲" : "▼"}</span>
          </button>

          {statutoryOpen && (
            <div className="p-4 space-y-4">
              {/* 날짜 고정 법정공휴일 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                    고정 법정공휴일 <span className="font-normal text-gray-400">(매년 동일 날짜)</span>
                  </p>
                  {admin && missingFixed.length > 0 && (
                    <button onClick={bulkAddFixed} disabled={bulkSaving}
                      className="text-[10px] px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50">
                      {bulkSaving ? "등록중…" : `미등록 ${missingFixed.length}개 일괄 등록`}
                    </button>
                  )}
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                      <th className="pb-1 text-left font-medium w-28">날짜</th>
                      <th className="pb-1 text-left font-medium">공휴일명</th>
                      <th className="pb-1 text-center font-medium w-16">상태</th>
                      {admin && <th className="pb-1 w-12" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {fixedStatutoryForYear.map(h => {
                      const dow = dayOfWeek(h.date);
                      const registered = registeredDates.has(h.date);
                      return (
                        <tr key={h.date} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="py-1.5 pr-4 whitespace-nowrap text-gray-700 dark:text-gray-200">
                            {parseInt(pad2(h.month))}월 {parseInt(pad2(h.day))}일
                            <span className={`ml-1 text-[10px] ${
                              dow === "일" ? "text-red-500" : dow === "토" ? "text-blue-500" : "text-gray-400"
                            }`}>({dow})</span>
                          </td>
                          <td className="py-1.5 text-gray-800 dark:text-gray-200 font-medium">{h.name}</td>
                          <td className="py-1.5 text-center">
                            {registered
                              ? <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">등록됨</span>
                              : <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full">미등록</span>
                            }
                          </td>
                          {admin && (
                            <td className="py-1.5 text-center">
                              {!registered && (
                                <button onClick={() => addSingleFixed(h.date, h.name)}
                                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline">
                                  등록
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 이동 법정공휴일 */}
              <div>
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">
                  이동 법정공휴일 <span className="font-normal text-gray-400">(음력 기준, 연도마다 날짜 상이)</span>
                </p>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {LUNAR_STATUTORY.map(h => (
                      <tr key={h.name} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="py-1.5 pr-4 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">{h.name}</td>
                        <td className="py-1.5 text-gray-500 dark:text-gray-400">{h.desc}</td>
                        <td className="py-1.5 text-[10px] text-orange-600 dark:text-orange-400 whitespace-nowrap">직접 등록 필요</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[10px] text-gray-400">※ 대체공휴일: 공휴일이 일요일·토요일·다른 공휴일과 겹치면 다음 비공휴일 평일이 대체공휴일이 됩니다.</p>
              </div>
            </div>
          )}
        </div>

        {/* ── 등록된 공휴일 목록 ── */}
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 px-1">
            {selectedYear}년 등록 공휴일
          </p>
          {loading ? (
            <div className="text-center py-8 text-gray-400 text-xs">불러오는 중…</div>
          ) : holidays.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-xs">{selectedYear}년 등록된 공휴일이 없습니다.</div>
          ) : (
            <div className="space-y-3">
              {Object.entries(grouped).map(([month, items]) => {
                const [y, m] = month.split("-");
                return (
                  <div key={month} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                        {y}년 {parseInt(m)}월 <span className="text-gray-400 font-normal">({items.length}개)</span>
                      </span>
                    </div>
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {items.map(h => {
                          const dow = dayOfWeek(h.date);
                          const isWeekend = dow === "토" || dow === "일";
                          return (
                            <tr key={h.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                              <td className="px-4 py-2 w-36 whitespace-nowrap">
                                <span className="text-gray-700 dark:text-gray-200">{formatDate(h.date)}</span>
                                <span className={`ml-1.5 text-[10px] font-medium ${
                                  dow === "일" ? "text-red-500" : dow === "토" ? "text-blue-500" : "text-gray-400"
                                }`}>({dow})</span>
                                {isWeekend && (
                                  <span className="ml-1 text-[9px] text-orange-500 bg-orange-50 dark:bg-orange-950/30 px-1 rounded">주말 중복</span>
                                )}
                              </td>
                              <td className="px-4 py-2">
                                {editId === h.id ? (
                                  <div className="flex items-center gap-2">
                                    <input value={editName} onChange={e => setEditName(e.target.value)}
                                      className="border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-400 w-40"
                                      onKeyDown={e => { if (e.key === "Enter") saveEdit(h.id); if (e.key === "Escape") setEditId(null); }}
                                      autoFocus
                                    />
                                    <button onClick={() => saveEdit(h.id)} disabled={editSaving}
                                      className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50">
                                      {editSaving ? "…" : "저장"}
                                    </button>
                                    <button onClick={() => setEditId(null)}
                                      className="px-2 py-0.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded">
                                      취소
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-gray-800 dark:text-gray-200 font-medium">{h.name}</span>
                                )}
                              </td>
                              {admin && editId !== h.id && (
                                <td className="px-4 py-2 text-right whitespace-nowrap">
                                  <button onClick={() => { setEditId(h.id); setEditName(h.name); }}
                                    className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 mr-3">
                                    수정
                                  </button>
                                  <button onClick={() => deleteHoliday(h.id, h.name)}
                                    className="text-gray-400 hover:text-red-600 dark:hover:text-red-400">
                                    삭제
                                  </button>
                                </td>
                              )}
                              {!admin && <td className="w-4" />}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              <div className="text-xs text-gray-400 text-right">{selectedYear}년 총 {holidays.length}개</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
