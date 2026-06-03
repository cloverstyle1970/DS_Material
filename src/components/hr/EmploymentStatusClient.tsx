"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { useReloadOnActivate } from "@/context/TabActivationContext";
import DraggableModal from "@/components/common/DraggableModal";

// 고용상태 변동 구분 (발령=인사이동과 분리해 여기서는 5종만 다룬다)
const STATUS_TYPES = ["입사", "퇴직", "휴직", "복직", "재입사"] as const;

// status_type → accounts.status 매핑
function mapToAccountStatus(t: string): string | null {
  switch (t) {
    case "퇴직": return "퇴사";
    case "휴직": return "휴직";
    case "입사":
    case "복직":
    case "재입사": return "재직";
    default: return null;
  }
}

interface EmployeeRow {
  id: number;
  username: string | null;
  name: string | null;
  dept: string | null;
  rank: string | null;
  status: string | null;
}

interface StatusRow {
  id: number;
  user_id: number;
  status_type: string;
  event_date: string | null;
  reason: string | null;
  user?: { id: number; username: string | null; name: string | null; status: string | null } | null;
}

function empName(e: { username?: string | null; name?: string | null }): string {
  return e.username || e.name || "(이름없음)";
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

function typeBadgeCls(t: string): string {
  if (t === "퇴직") return "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300";
  if (t === "휴직") return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300";
  return "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"; // 입사/복직/재입사
}

const inputCls =
  "w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100";
const labelCls = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";

export default function EmploymentStatusClient() {
  const { user } = useAuth();
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  async function loadAll() {
    setLoading(true);
    const [{ data: histData }, { data: empData }] = await Promise.all([
      supabase
        .from("user_status_history")
        .select("id,user_id,status_type,event_date,reason,user:accounts(id,username,name:username,status)")
        .in("status_type", [...STATUS_TYPES])
        .order("event_date", { ascending: false })
        .order("id", { ascending: false }),
      supabase.from("accounts").select("id,username,name:username,dept,rank,status").order("username"),
    ]);
    setRows((histData ?? []) as unknown as StatusRow[]);
    setEmployees((empData ?? []) as EmployeeRow[]);
    setLoading(false);
  }

  useEffect(() => {
    loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);
  useReloadOnActivate(loadAll);

  const filtered = useMemo(() => {
    const kw = search.trim();
    return rows.filter(r => {
      if (typeFilter && r.status_type !== typeFilter) return false;
      if (kw && !((r.user?.username ?? "") + (r.user?.name ?? "")).includes(kw)) return false;
      return true;
    });
  }, [rows, search, typeFilter]);

  async function remove(r: StatusRow) {
    if (!confirm(`'${r.user ? empName(r.user) : ""}'의 ${r.status_type} 이력(${r.event_date ?? ""})을 삭제하시겠습니까?\n(사원의 현재 재직상태는 되돌리지 않습니다.)`)) return;
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
  if (!isAdmin(user)) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">관리자 권한이 필요합니다</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">재직상태 관리 페이지는 관리자만 접근할 수 있습니다.</div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">재직상태 관리</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          입사·퇴직·휴직·복직·재입사 이력을 기록합니다. 등록 시 사원의 현재 재직상태가 자동 반영됩니다.
        </p>
      </div>

      <div className="px-6 py-4 space-y-3">
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
            {STATUS_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="px-3 py-2 rounded bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800"
          >
            + 상태변경 등록
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            총 {filtered.length}건
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase">
                <tr>
                  <th className="px-3 py-2 text-center whitespace-nowrap">변경일자</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">성명</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">구분</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">현재 상태</th>
                  <th className="px-3 py-2 text-left">사유</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-gray-500">불러오는 중…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-gray-500">재직상태 변경 이력이 없습니다.</td></tr>
                )}
                {!loading && filtered.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2 text-center text-xs font-mono text-gray-600 dark:text-gray-300 whitespace-nowrap">{r.event_date ?? "-"}</td>
                    <td className="px-3 py-2 text-center text-xs font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">{r.user ? empName(r.user) : "-"}</td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${typeBadgeCls(r.status_type)}`}>
                        {r.status_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.user?.status ?? "-"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{r.reason || "-"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        className="px-2 py-0.5 text-[11px] rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showNew && (
        <StatusModal
          employees={employees}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); loadAll(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// 재직상태 변경 등록 모달
// ============================================================

function StatusModal({
  employees, onClose, onSaved,
}: {
  employees: EmployeeRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [userId, setUserId] = useState<number | "">("");
  const [empQuery, setEmpQuery] = useState("");
  const [empOpen, setEmpOpen] = useState(false);
  const [statusType, setStatusType] = useState<string>(STATUS_TYPES[1]); // 기본 '퇴직'
  const [eventDate, setEventDate] = useState<string>(todayYmd());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const targets = useMemo(
    () => [...employees].sort((a, b) => empName(a).localeCompare(empName(b), "ko")),
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
    if (!statusType) { alert("구분을 선택하세요."); return; }
    if (!eventDate) { alert("변경일자를 입력하세요."); return; }

    setSaving(true);
    const { error } = await supabase.from("user_status_history").insert({
      user_id: userId,
      status_type: statusType,
      event_date: eventDate || null,
      reason: reason.trim() || null,
      sort_order: 0,
    });
    if (error) {
      setSaving(false);
      alert(`저장 실패: ${error.message}`);
      return;
    }

    // accounts 현재 재직상태 자동 반영
    const patch: { status?: string; resign_date?: string | null } = {};
    const accStatus = mapToAccountStatus(statusType);
    if (accStatus) patch.status = accStatus;
    if (statusType === "퇴직") patch.resign_date = eventDate || null;
    if (statusType === "재입사") patch.resign_date = null;

    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await supabase.from("accounts").update(patch).eq("id", userId);
      if (upErr) {
        setSaving(false);
        alert(`이력은 저장됐으나 사원 현재 상태 반영에 실패했습니다: ${upErr.message}`);
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
          <div className="text-base font-bold text-gray-900 dark:text-white">재직상태 변경 등록</div>
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
            <label className={labelCls}>구분 *</label>
            <select value={statusType} onChange={e => setStatusType(e.target.value)} className={inputCls}>
              {STATUS_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
          현재 재직상태: <span className="font-semibold">{emp?.status || "-"}</span>
          {mapToAccountStatus(statusType) && (
            <> → 변경 후: <span className="font-semibold text-blue-600 dark:text-blue-400">{mapToAccountStatus(statusType)}</span></>
          )}
        </div>

        <div>
          <label className={labelCls}>변경일자 *</label>
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

        <div>
          <label className={labelCls}>사유 / 비고</label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="예: 일신상의 사유, 산전후 휴가, 복직 발령 등"
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
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </DraggableModal>
  );
}
