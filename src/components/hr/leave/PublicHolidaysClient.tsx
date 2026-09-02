"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

interface Holiday {
  id: number;
  date: string;
  name: string;
}

function formatDate(date: string) {
  const [y, m, d] = date.split("-");
  return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
}

function dayOfWeek(date: string) {
  const d = new Date(date);
  return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
}

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 1 + i);

export default function PublicHolidaysClient() {
  const { user } = useAuth();
  const admin = user ? isAdmin(user) : false;

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addName, setAddName] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("public_holidays")
      .select("id,date,name")
      .gte("date", `${selectedYear}-01-01`)
      .lte("date", `${selectedYear}-12-31`)
      .order("date");
    setHolidays((data as Holiday[] | null) ?? []);
    setLoading(false);
  }, [selectedYear]);

  useEffect(() => { load(); }, [load]);

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

      {/* 목록 */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중…</div>
        ) : holidays.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{selectedYear}년 등록된 공휴일이 없습니다.</div>
        ) : (
          <div className="space-y-4 max-w-xl">
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
  );
}
