"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";

interface Department { id: number; name: string; sort_order: number; is_active: boolean }
interface Crew { id: number; department_id: number; name: string; sort_order: number; is_active: boolean }
interface UserRow { id: number; name: string; dept: string | null; rank: string | null; crew_id: number | null }

export default function TeamCrewClient() {
  const { user } = useAuth();
  const [depts, setDepts] = useState<Department[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCrew, setEditingCrew] = useState<Crew | null>(null);
  const [addingForDept, setAddingForDept] = useState<Department | null>(null);
  const [openDeptIds, setOpenDeptIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const [d, c, u] = await Promise.all([
      supabase.from("departments").select("id, name, sort_order, is_active").eq("is_active", true).order("sort_order"),
      supabase.from("crews").select("id, department_id, name, sort_order, is_active").order("sort_order"),
      supabase.from("accounts").select("id, name:username, dept, rank, crew_id").order("username"),
    ]);
    setDepts((d.data ?? []) as Department[]);
    setCrews((c.data ?? []) as Crew[]);
    setUsers((u.data ?? []) as UserRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 부서 열림 상태: 첫 로드 후 모든 부서 펼치기 (1회만)
  // ref 가드 없이 openDeptIds.size===0 만 보면, 사용자가 마지막 부서를 접어 set이
  // 빌 때마다 다시 모두 펼치는 버그가 발생함.
  const initialExpandedRef = useRef(false);
  useEffect(() => {
    if (depts.length > 0 && !initialExpandedRef.current) {
      setOpenDeptIds(new Set(depts.map(d => d.id)));
      initialExpandedRef.current = true;
    }
  }, [depts]);

  // 부서별 사원·조 인덱스
  const usersByDept = useMemo(() => {
    const m = new Map<string, UserRow[]>();
    for (const u of users) {
      const key = (u.dept ?? "").trim();
      if (!key) continue;
      const arr = m.get(key) ?? [];
      arr.push(u);
      m.set(key, arr);
    }
    return m;
  }, [users]);

  const crewsByDept = useMemo(() => {
    const m = new Map<number, Crew[]>();
    for (const c of crews) {
      const arr = m.get(c.department_id) ?? [];
      arr.push(c);
      m.set(c.department_id, arr);
    }
    return m;
  }, [crews]);

  async function moveMemberToCrew(userId: number, crewId: number | null) {
    const { error } = await supabase.from("accounts").update({ crew_id: crewId }).eq("id", userId);
    if (error) { alert(`이동 실패: ${error.message}`); return; }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, crew_id: crewId } : u));
  }

  async function removeCrew(c: Crew) {
    const members = users.filter(u => u.crew_id === c.id);
    if (members.length > 0) {
      if (!confirm(`'${c.name}' 조에 ${members.length}명이 배정되어 있습니다.\n삭제 시 해당 사원들의 조 배정이 해제됩니다. 계속할까요?`)) return;
    } else if (!confirm(`'${c.name}' 조를 삭제할까요?`)) return;
    const { error } = await supabase.from("crews").delete().eq("id", c.id);
    if (error) { alert(`삭제 실패: ${error.message}`); return; }
    await load();
  }

  function toggleDept(id: number) {
    setOpenDeptIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (!user) {
    return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  }
  if (!hasMenuPermission(user, "/hr/team-crew", "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">팀구성 관리 메뉴 권한이 필요합니다.</div>
      </div>
    );
  }
  const canWrite = hasMenuPermission(user, "/hr/team-crew", "create") || hasMenuPermission(user, "/hr/team-crew", "update");

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-gray-900 dark:text-white">팀구성 관리</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">팀(부서)별 조(crew) 편성과 사원 배정 — 관리자 전용</p>
        </div>
        <button type="button" onClick={() => void load()}
          className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
          🔄 새로고침
        </button>
      </div>

      <div className="px-6 py-4 space-y-3">
        {loading && <div className="text-center text-sm text-gray-500 py-12">불러오는 중...</div>}

        {!loading && depts.length === 0 && (
          <div className="text-center text-sm text-gray-500 py-12">
            활성 부서가 없습니다. <span className="text-blue-600">[부서/직급 관리]</span> 에서 먼저 부서를 등록하세요.
          </div>
        )}

        {!loading && depts.map(dept => {
          const dCrews = (crewsByDept.get(dept.id) ?? []).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
          const dUsers = usersByDept.get(dept.name) ?? [];
          const dCrewIdSet = new Set(dCrews.map(c => c.id));
          const unassigned = dUsers.filter(u => !u.crew_id || !dCrewIdSet.has(u.crew_id));
          const isOpen = openDeptIds.has(dept.id);

          return (
            <div key={dept.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button type="button" onClick={() => toggleDept(dept.id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-100">
                  <span className="text-gray-400 dark:text-gray-500 text-xs w-3">{isOpen ? "▼" : "▶"}</span>
                  <span>📁 {dept.name}</span>
                  <span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                    · 사원 {dUsers.length}명 · 조 {dCrews.length}개 · 미배정 {unassigned.length}명
                  </span>
                </div>
                {canWrite && (
                  <span onClick={e => { e.stopPropagation(); setAddingForDept(dept); }}
                    className="px-2.5 py-1 text-[11px] rounded bg-slate-700 text-white font-semibold hover:bg-slate-800 cursor-pointer">
                    + 조 추가
                  </span>
                )}
              </button>

              {isOpen && (
                <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3 space-y-3">
                  {dCrews.length === 0 && (
                    <div className="text-center text-[11px] text-gray-400 dark:text-gray-500 py-4">
                      등록된 조가 없습니다. 우측 상단 [+ 조 추가] 로 시작하세요.
                    </div>
                  )}
                  {dCrews.map(c => {
                    const members = dUsers.filter(u => u.crew_id === c.id);
                    return (
                      <div key={c.id} className={`rounded-lg border ${c.is_active ? "border-gray-200 dark:border-gray-600" : "border-dashed border-gray-300 dark:border-gray-600 opacity-60"} bg-gray-50 dark:bg-gray-700/30 px-3 py-2`}>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-gray-800 dark:text-gray-100">🧑‍🤝‍🧑 {c.name}</span>
                            <span className="text-gray-500 dark:text-gray-400">· {members.length}명</span>
                            {!c.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">비활성</span>}
                          </div>
                          {canWrite && (
                            <div className="flex items-center gap-1.5">
                              <button type="button" onClick={() => setEditingCrew(c)}
                                className="px-2.5 py-1 text-[11px] font-semibold rounded bg-blue-600 text-white hover:bg-blue-700">
                                ✏️ 조 수정
                              </button>
                              <button type="button" onClick={() => void removeCrew(c)}
                                className="px-2.5 py-1 text-[11px] font-semibold rounded bg-red-500 text-white hover:bg-red-600">
                                🗑 삭제
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {members.length === 0 && (
                            <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">배정된 사원 없음</span>
                          )}
                          {members.map(m => (
                            <span key={m.id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200">
                              {m.name} {m.rank && <span className="text-gray-400 dark:text-gray-500">({m.rank})</span>}
                              {canWrite && (
                                <button type="button" onClick={() => void moveMemberToCrew(m.id, null)}
                                  title="조 배정 해제"
                                  className="text-gray-400 hover:text-red-500 leading-none">×</button>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {unassigned.length > 0 && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 px-3 py-2">
                      <div className="text-xs font-bold text-amber-800 dark:text-amber-200 mb-1.5">⚠️ 미배정 사원 ({unassigned.length}명)</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <tbody>
                            {unassigned.map(m => (
                              <tr key={m.id} className="border-t border-amber-100 dark:border-amber-800/40">
                                <td className="py-1 text-gray-800 dark:text-gray-200">
                                  {m.name} {m.rank && <span className="text-gray-400 dark:text-gray-500">({m.rank})</span>}
                                  {m.crew_id && <span className="ml-1 text-[10px] text-red-600 dark:text-red-400">[타 부서 조에 잘못 배정됨]</span>}
                                </td>
                                <td className="py-1 text-right">
                                  {!canWrite ? null : dCrews.filter(c => c.is_active).length === 0 ? (
                                    <span className="text-[10px] text-amber-700 dark:text-amber-300">활성 조 없음</span>
                                  ) : (
                                    <select value=""
                                      onChange={e => { const cid = Number(e.target.value); if (cid) void moveMemberToCrew(m.id, cid); }}
                                      className="text-[11px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
                                      <option value="">조 배정 ▼</option>
                                      {dCrews.filter(c => c.is_active).map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                      ))}
                                    </select>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(addingForDept || editingCrew) && (() => {
        const targetDept = addingForDept ?? depts.find(d => d.id === editingCrew!.department_id)!;
        const deptUsers = usersByDept.get(targetDept.name) ?? [];
        const deptCrewIds = new Set((crewsByDept.get(targetDept.id) ?? []).map(c => c.id));
        return (
          <CrewEditModal
            dept={targetDept}
            initial={editingCrew}
            deptUsers={deptUsers}
            deptCrewIds={deptCrewIds}
            onClose={() => { setAddingForDept(null); setEditingCrew(null); }}
            onSaved={() => { setAddingForDept(null); setEditingCrew(null); void load(); }}
          />
        );
      })()}
    </div>
  );
}

const CREW_MIN = 2;
const CREW_MAX = 4;

function CrewEditModal({
  dept, initial, deptUsers, deptCrewIds, onClose, onSaved,
}: {
  dept: Department;
  initial: Crew | null;
  deptUsers: UserRow[];      // 이 부서에 속한 사원 전체
  deptCrewIds: Set<number>;  // 이 부서의 활성 조 id 집합 (다른 조 배정 여부 판단용)
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  // 멤버 선택: 수정 모드면 현재 이 조에 속한 사원으로 초기화, 신규는 비어 있음
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(initial ? deptUsers.filter(u => u.crew_id === initial.id).map(u => u.id) : [])
  );

  // 같은 부서 사원 중 선택 가능한 후보:
  //  - 이미 이 조에 속한 사원 (수정 시)
  //  - 어떤 조에도 안 속하거나, 같은 부서의 다른 조에 속한 사원 (이동 가능)
  const candidates = useMemo(() => {
    return deptUsers.slice().sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [deptUsers]);

  function toggleMember(id: number) {
    setSelectedIds(prev => {
      if (prev.has(id)) {
        const next = new Set(prev); next.delete(id); return next;
      }
      if (prev.size >= CREW_MAX) {
        alert(`한 조는 최대 ${CREW_MAX}명까지 가능합니다.`);
        return prev;
      }
      const next = new Set(prev); next.add(id); return next;
    });
  }

  async function save() {
    if (!name.trim()) { alert("조 이름은 필수입니다."); return; }
    if (selectedIds.size > CREW_MAX) {
      alert(`한 조는 최대 ${CREW_MAX}명까지 가능합니다. (현재 ${selectedIds.size}명)`);
      return;
    }
    if (selectedIds.size > 0 && selectedIds.size < CREW_MIN) {
      if (!confirm(`권장 인원은 ${CREW_MIN}~${CREW_MAX}명입니다. ${selectedIds.size}명으로 저장하시겠습니까?`)) return;
    }

    setSaving(true);
    try {
      const payload = { department_id: dept.id, name: name.trim(), sort_order: Number(sortOrder) || 0, is_active: isActive };

      let crewId: number;
      if (initial) {
        const { error } = await supabase.from("crews").update(payload).eq("id", initial.id);
        if (error) throw error;
        crewId = initial.id;
      } else {
        const { data, error } = await supabase.from("crews").insert(payload).select("id").single();
        if (error) throw error;
        crewId = Number(data!.id);
      }

      // 멤버 배정 동기화
      const previousMemberIds = initial
        ? deptUsers.filter(u => u.crew_id === initial.id).map(u => u.id)
        : [];
      const toAssign = Array.from(selectedIds).filter(id => !previousMemberIds.includes(id));
      const toRemove = previousMemberIds.filter(id => !selectedIds.has(id));

      if (toAssign.length > 0) {
        const { error: aErr } = await supabase.from("accounts").update({ crew_id: crewId }).in("id", toAssign);
        if (aErr) throw aErr;
      }
      if (toRemove.length > 0) {
        const { error: rErr } = await supabase.from("accounts").update({ crew_id: null }).in("id", toRemove);
        if (rErr) throw rErr;
      }

      onSaved();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      alert(err.code === "23505" ? `${dept.name} 안에 같은 이름의 조가 이미 있습니다.` : (err.message ?? "저장 실패"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-md"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">
            {initial ? `${dept.name} · 조 수정` : `${dept.name} · 조 추가`}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
      <div className="p-5 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">조 이름 *</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} lang="ko" autoFocus
            placeholder="예) 1조, A조, 강북조"
            onKeyDown={e => { if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) { e.preventDefault(); void save(); } }}
            className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">정렬 순서</label>
            <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100" />
          </div>
          <label className="flex items-end gap-2 pb-2 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)}
              className="w-4 h-4" />
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">활성</span>
          </label>
        </div>

        {/* 멤버 선택 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              조원 선택 <span className="text-gray-400 font-normal">({dept.name} 사원 중)</span>
            </label>
            <span className={`text-[11px] font-bold ${
              selectedIds.size > CREW_MAX
                ? "text-red-600 dark:text-red-400"
                : selectedIds.size >= CREW_MIN && selectedIds.size <= CREW_MAX
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
            }`}>
              {selectedIds.size} / {CREW_MAX}명
              <span className="ml-1 text-gray-400 font-normal">권장 {CREW_MIN}~{CREW_MAX}</span>
            </span>
          </div>
          {candidates.length === 0 ? (
            <div className="text-[11px] text-gray-400 dark:text-gray-500 italic py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded">
              {dept.name}에 등록된 사원이 없습니다.
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
              {candidates.map(u => {
                const checked = selectedIds.has(u.id);
                const inAnotherCrew = !checked && u.crew_id != null && deptCrewIds.has(u.crew_id) && (!initial || u.crew_id !== initial.id);
                const atLimit = !checked && selectedIds.size >= CREW_MAX;
                return (
                  <label key={u.id}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs border-b border-gray-100 dark:border-gray-700/50 last:border-0 cursor-pointer transition-colors ${
                      checked ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-700/30"
                    } ${atLimit ? "opacity-50" : ""}`}>
                    <input type="checkbox" checked={checked} disabled={atLimit}
                      onChange={() => toggleMember(u.id)} className="rounded" />
                    <span className="font-semibold text-gray-700 dark:text-gray-200">{u.name}</span>
                    {u.rank && <span className="text-gray-400 dark:text-gray-500">({u.rank})</span>}
                    {inAnotherCrew && (
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                        다른 조 소속 — 선택 시 이동
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
        <button type="button" onClick={save} disabled={saving}
          className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </DraggableModal>
  );
}
