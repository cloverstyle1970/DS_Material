"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import DraggableModal from "@/components/common/DraggableModal";

// 발령(부서이동·진급 등) 구분. 고용상태 변동(입사/퇴직 등)은 개인정보수정 탭에서 관리.
const ASSIGNMENT_TYPES = ["부서이동", "진급", "강등", "전보", "직책변경", "겸직"] as const;
const ALL_TYPES = ["입사", "퇴직", "휴직", "복직", "재입사", ...ASSIGNMENT_TYPES] as const;

// 직급 변동(진급/강등)은 to_rank, 부서 변동(부서이동/전보)은 to_dept를 주로 다룬다.
const RANK_TYPES = new Set(["진급", "강등"]);
const DEPT_TYPES = new Set(["부서이동", "전보"]);

interface OrgItem {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
}

interface EmployeeRow {
  id: number;
  username: string | null;
  name: string | null;
  dept: string | null;
  rank: string | null;
  status: string | null;
}

interface AssignmentRow {
  id: number;
  user_id: number;
  status_type: string;
  event_date: string | null;
  from_dept: string | null;
  to_dept: string | null;
  from_rank: string | null;
  to_rank: string | null;
  reason: string | null;
  user?: { id: number; username: string | null; name: string | null } | null;
}

function formatYmd(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function empName(e: { username?: string | null; name?: string | null }): string {
  return e.username || e.name || "(이름없음)";
}

function changeText(r: AssignmentRow): string {
  const parts: string[] = [];
  if (r.to_dept && r.to_dept !== r.from_dept) parts.push(`부서 ${r.from_dept ?? "-"} → ${r.to_dept}`);
  if (r.to_rank && r.to_rank !== r.from_rank) parts.push(`직급 ${r.from_rank ?? "-"} → ${r.to_rank}`);
  return parts.length ? parts.join(" · ") : "-";
}

const inputCls =
  "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";
const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";

export default function TransferClient() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [depts, setDepts] = useState<OrgItem[]>([]);
  const [ranks, setRanks] = useState<OrgItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  // 필터
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  async function loadAll() {
    setLoading(true);
    const [{ data: histData }, { data: empData }, { data: deptData }, { data: rankData }] = await Promise.all([
      supabase
        .from("user_status_history")
        .select("id,user_id,status_type,event_date,from_dept,to_dept,from_rank,to_rank,reason,user:accounts(id,username,name:username)")
        .order("event_date", { ascending: false })
        .order("id", { ascending: false }),
      supabase.from("accounts").select("id,username,name:username,dept,rank,status").order("username"),
      supabase.from("departments").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("ranks").select("*").eq("is_active", true).order("sort_order"),
    ]);
    setRows((histData ?? []) as unknown as AssignmentRow[]);
    setEmployees((empData ?? []) as EmployeeRow[]);
    setDepts((deptData ?? []) as OrgItem[]);
    setRanks((rankData ?? []) as OrgItem[]);
    setLoading(false);
  }

  useEffect(() => {
    loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const filtered = useMemo(() => {
    const kw = search.trim();
    return rows.filter(r => {
      if (typeFilter && r.status_type !== typeFilter) return false;
      if (kw && !((r.user?.username ?? "") + (r.user?.name ?? "")).includes(kw)) return false;
      return true;
    });
  }, [rows, search, typeFilter]);

  async function remove(r: AssignmentRow) {
    if (!confirm(`'${r.user ? empName(r.user) : ""}'의 ${r.status_type} 이력(${r.event_date ?? ""})을 삭제하시겠습니까?\n(사원의 현재 부서·직급은 되돌리지 않습니다.)`)) return;
    const { error } = await supabase.from("user_status_history").delete().eq("id", r.id);
    if (error) {
      alert(`삭제 실패: ${error.message}`);
      return;
    }
    loadAll();
  }

  if (!user) {
    return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  }
  if (!hasMenuPermission(user, "/hr/transfer", "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">인사 이동(발령) 관리 메뉴 권한이 필요합니다.</div>
      </div>
    );
  }
  const canWrite = hasMenuPermission(user, "/hr/transfer", "create") || hasMenuPermission(user, "/hr/transfer", "update");

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">인사 이동 (발령) 관리</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          사원의 부서이동·진급 등 발령 이력을 기록합니다. 발령 등록 시 사원의 현재 부서·직급이 자동 반영됩니다.
        </p>
      </div>

      <div className="px-6 py-4 space-y-3">
        {/* 필터바 */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="사원명 검색"
            lang="ko"
            className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 w-40"
          />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
          >
            <option value="">전체 구분</option>
            {ALL_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div className="flex-1" />
          {canWrite && (
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="px-3 py-2 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800"
            >
              + 발령 등록
            </button>
          )}
        </div>

        {/* 목록 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            총 {filtered.length}건
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase">
                <tr>
                  <th className="px-3 py-2 text-center whitespace-nowrap">발령일자</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">성명</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">발령구분</th>
                  <th className="px-3 py-2 text-left">변경 내용</th>
                  <th className="px-3 py-2 text-left">사유</th>
                  {canWrite && <th className="px-3 py-2 text-right">액션</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && (
                  <tr><td colSpan={canWrite ? 6 : 5} className="px-3 py-8 text-center text-xs text-gray-500">불러오는 중…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={canWrite ? 6 : 5} className="px-3 py-8 text-center text-xs text-gray-500">발령 이력이 없습니다.</td></tr>
                )}
                {!loading && filtered.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2 text-center text-xs font-mono text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.event_date ?? "-"}</td>
                    <td className="px-3 py-2 text-center text-xs font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">{r.user ? empName(r.user) : "-"}</td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                        {r.status_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-200">{changeText(r)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{r.reason || "-"}</td>
                    {canWrite && (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => remove(r)}
                          className="px-2 py-0.5 text-[11px] rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200"
                        >
                          삭제
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showNew && (
        <AssignmentModal
          employees={employees}
          depts={depts}
          ranks={ranks}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); loadAll(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// 발령 등록 모달
// ============================================================

function AssignmentModal({
  employees, depts, ranks, onClose, onSaved,
}: {
  employees: EmployeeRow[];
  depts: OrgItem[];
  ranks: OrgItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [userId, setUserId] = useState<number | "">("");
  const [empQuery, setEmpQuery] = useState("");
  const [empOpen, setEmpOpen] = useState(false);
  const [statusType, setStatusType] = useState<string>(ASSIGNMENT_TYPES[0]);
  const [eventDate, setEventDate] = useState<string>(todayYmd());
  const [toDept, setToDept] = useState("");
  const [toRank, setToRank] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // 신규 발령 대상은 재직자 우선
  const targets = useMemo(
    () => employees.filter(e => e.status !== "퇴사").sort((a, b) => empName(a).localeCompare(empName(b), "ko")),
    [employees]
  );
  const emp = useMemo(() => employees.find(e => e.id === userId) ?? null, [employees, userId]);

  const matched = useMemo(() => {
    const kw = empQuery.trim();
    if (!kw) return targets;
    return targets.filter(e =>
      (e.username ?? "").includes(kw) || (e.name ?? "").includes(kw) ||
      (e.dept ?? "").includes(kw) || (e.rank ?? "").includes(kw)
    );
  }, [targets, empQuery]);

  function selectEmp(e: EmployeeRow) {
    setUserId(e.id);
    setEmpQuery(empName(e));
    setEmpOpen(false);
  }

  async function save() {
    if (userId === "") { alert("대상 사원을 선택하세요."); return; }
    if (!statusType) { alert("발령구분을 선택하세요."); return; }
    if (!eventDate) { alert("발령일자를 입력하세요."); return; }
    if (!toDept && !toRank) { alert("변경 후 부서 또는 직급 중 하나는 입력해야 합니다."); return; }

    setSaving(true);
    const fromDept = emp?.dept ?? null;
    const fromRank = emp?.rank ?? null;
    const { error } = await supabase.from("user_status_history").insert({
      user_id: userId,
      status_type: statusType,
      event_date: eventDate || null,
      from_dept: fromDept,
      to_dept: toDept || null,
      from_rank: fromRank,
      to_rank: toRank || null,
      reason: reason.trim() || null,
      sort_order: 0,
    });
    if (error) {
      setSaving(false);
      alert(`저장 실패: ${error.message}`);
      return;
    }

    // users 본체 자동 반영 (입력된 값만)
    const patch: { dept?: string; rank?: string } = {};
    if (toDept) patch.dept = toDept;
    if (toRank) patch.rank = toRank;
    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await supabase.from("accounts").update(patch).eq("id", userId);
      if (upErr) {
        setSaving(false);
        alert(`발령 이력은 저장됐으나 사원 본체 반영에 실패했습니다: ${upErr.message}`);
        onSaved();
        return;
      }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <DraggableModal
      open={true}
      onClose={onClose}
      panelClassName="w-full max-w-lg"
      z={60}
      header={
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-base font-bold text-gray-900 dark:text-white">발령 등록</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
      }
    >
      <div className="p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <label className={labelCls}>대상 사원 *</label>
            <input
              type="text"
              value={empQuery}
              onChange={ev => { setEmpQuery(ev.target.value); setEmpOpen(true); if (userId !== "") setUserId(""); }}
              onFocus={() => setEmpOpen(true)}
              onBlur={() => setEmpOpen(false)}
              placeholder="사원명 입력하여 검색"
              lang="ko"
              autoComplete="off"
              className={inputCls}
            />
            {empOpen && (
              <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-lg text-sm">
                {matched.length === 0 && (
                  <li className="px-3 py-2 text-xs text-gray-400">일치하는 사원이 없습니다.</li>
                )}
                {matched.map(e => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onMouseDown={ev => { ev.preventDefault(); selectEmp(e); }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                    >
                      {empName(e)}
                      <span className="ml-1 text-[11px] text-gray-400">
                        {e.dept || ""}{e.rank ? ` · ${e.rank}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className={labelCls}>발령구분 *</label>
            <select value={statusType} onChange={e => setStatusType(e.target.value)} className={inputCls}>
              {ASSIGNMENT_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 현재 부서/직급 (from, 자동) */}
        <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
          현재 — 부서: <span className="font-semibold">{emp?.dept || "-"}</span> · 직급: <span className="font-semibold">{emp?.rank || "-"}</span>
        </div>

        <div>
          <label className={labelCls}>발령일자 *</label>
          <input
            type="text"
            value={eventDate}
            onChange={e => setEventDate(formatYmd(e.target.value))}
            placeholder="YYYYMMDD"
            inputMode="numeric"
            maxLength={10}
            className={inputCls + " font-mono"}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              변경 후 부서 {DEPT_TYPES.has(statusType) && <span className="text-purple-500">●</span>}
            </label>
            <select value={toDept} onChange={e => setToDept(e.target.value)} className={inputCls}>
              <option value="">변경 없음</option>
              {depts.map(d => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              변경 후 직급 {RANK_TYPES.has(statusType) && <span className="text-purple-500">●</span>}
            </label>
            <select value={toRank} onChange={e => setToRank(e.target.value)} className={inputCls}>
              <option value="">변경 없음</option>
              {ranks.map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>사유 / 비고</label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="예: 조직 개편, 정기 인사, 승진 발령 등"
            lang="ko"
            className={inputCls}
          />
        </div>
      </div>

      <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 rounded text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">취소</button>
        <button type="button" onClick={save} disabled={saving}
          className="px-4 py-2 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "저장 중..." : "발령 저장"}
        </button>
      </div>
    </DraggableModal>
  );
}
