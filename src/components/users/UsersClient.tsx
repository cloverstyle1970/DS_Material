"use client";

import { useState, useMemo, useEffect } from "react";
import { UserRecord, Permission } from "@/lib/mock-users";
import { useAuth, isAdmin } from "@/context/AuthContext";
import { api, getErrorMessage } from "@/lib/api-client";
import PermissionsModal from "./PermissionsModal";

type SortKey = "id" | "name" | "dept" | "rank" | "cert" | "hireDate" | "phone" | "status";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey | null; label: string; sortable: boolean }[] = [
  { key: "id",       label: "번호",     sortable: true  },
  { key: "name",     label: "이름",     sortable: true  },
  { key: "dept",     label: "부서",     sortable: true  },
  { key: "rank",     label: "직급",     sortable: true  },
  { key: "cert",     label: "자격증",   sortable: true  },
  { key: "hireDate", label: "입사일",   sortable: true  },
  { key: "phone",    label: "전화번호", sortable: true  },
  { key: "status",   label: "상태",     sortable: true  },
];

const STATUS_STYLES: Record<string, string> = {
  "재직": "bg-green-50 text-green-700",
  "퇴직": "bg-gray-100 text-gray-500",
};

const PERMISSION_OPTIONS: { value: Permission; label: string; desc: string; color: string }[] = [
  { value: "admin",       label: "시스템 관리자", desc: "모든 기능 접근",        color: "bg-red-50 text-red-600"    },
  { value: "site_manage", label: "현장 관리",     desc: "현장 등록·수정 가능",   color: "bg-blue-50 text-blue-600"  },
  { value: "view_only",   label: "조회 전용",     desc: "읽기만 가능",           color: "bg-gray-100 text-gray-500" },
];

function PermBadge({ perms }: { perms: string[] }) {
  if (perms.includes("admin")) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-600">시스템 관리자</span>;
  
  const menuPerms = perms.filter(p => p.startsWith("menu:"));
  const viewOnly = perms.includes("view_only");
  const siteManage = perms.includes("site_manage");

  return (
    <>
      {siteManage && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-600">현장 관리</span>}
      {viewOnly && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">조회 전용</span>}
      {menuPerms.length > 0 && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-600">상세 권한 {menuPerms.length}개</span>}
    </>
  );
}

function maskSsn(ssn: string | null): string {
  if (!ssn) return "-";
  const s = String(ssn);
  if (s.length >= 7) return s.slice(0, 6) + "-" + s[6] + "******";
  return s;
}

const PAGE_SIZE = 20;

export default function UsersClient({ initial }: { initial: UserRecord[] }) {
  const [users, setUsers] = useState(initial);
  const [query, setQuery] = useState("");
  const [showResigned, setShowResigned] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<UserRecord | null>(null);
  const [editPerms, setEditPerms] = useState<UserRecord | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    api.get<UserRecord[]>("/api/users").then(setUsers).catch(() => {});
  }, []);

  const { user: me } = useAuth();
  const meIsAdmin = me ? isAdmin(me) : false;

  const q = query.trim().toLowerCase();
  const filtered = users.filter(u => {
    if (!showResigned && u.status === "퇴직") return false;
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      (u.dept?.toLowerCase().includes(q) ?? false) ||
      (u.rank?.toLowerCase().includes(q) ?? false) ||
      (u.phone?.includes(q) ?? false) ||
      String(u.id).includes(q)
    );
  });

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // null/undefined는 항상 뒤로
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), "ko");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function changePage(next: number) { setPage(Math.max(1, Math.min(next, totalPages))); }
  function resetPage() { setPage(1); }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  const active = users.filter(u => u.status === "재직").length;

  function openEditPerms(u: UserRecord) {
    setEditPerms(u);
  }

  return (
    <>
      {/* 툴바 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input value={query} onChange={e => { setQuery(e.target.value); resetPage(); }}
            placeholder="이름, 부서, 직급, 전화번호 검색"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white dark:bg-gray-700" />
          {query && <button onClick={() => { setQuery(""); resetPage(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">×</button>}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
          <input type="checkbox" checked={showResigned} onChange={e => { setShowResigned(e.target.checked); resetPage(); }} className="rounded" />
          퇴직자 포함
        </label>
        <span className="ml-auto text-xs font-semibold bg-gray-900 dark:bg-gray-700 text-white px-3 py-1.5 rounded-lg">
          {q ? `검색 ${filtered.length}명` : `재직 ${active}명`}
        </span>
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-250px)]">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
            <tr>
              {COLUMNS.map(c => {
                const active = c.sortable && c.key === sortKey;
                return (
                  <th key={c.label} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {c.sortable && c.key ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key as SortKey)}
                        className={`flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${active ? "text-gray-700 dark:text-gray-100 font-semibold" : ""}`}
                      >
                        {c.label}
                        <span className={`text-[10px] ${active ? "opacity-100" : "opacity-30"}`}>
                          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
              {meIsAdmin && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {filtered.length === 0 ? (
              <tr><td colSpan={meIsAdmin ? 9 : 8} className="text-center py-12 text-gray-400 dark:text-gray-500">
                {q ? "검색 결과가 없습니다" : "등록된 사용자가 없습니다"}
              </td></tr>
            ) : paginated.map(u => (
              <tr key={u.id} onClick={() => setSelected(u)}
                className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer">
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs">{u.id}</td>
                <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">{u.name}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{u.dept ?? "-"}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{u.rank ?? "-"}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{u.cert ?? "-"}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{u.hireDate ?? "-"}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{u.phone ?? "-"}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[u.status ?? ""] ?? "bg-gray-100 text-gray-500"}`}>
                    {u.status ?? "-"}
                  </span>
                </td>
                {meIsAdmin && (
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <button type="button" onClick={() => openEditPerms(u)}
                      className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors whitespace-nowrap">
                      권한 수정
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-700/30">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString()} / {filtered.length.toLocaleString()}명
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => changePage(1)} disabled={safePage === 1}
                className="px-2 py-1.5 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">«</button>
              <button onClick={() => changePage(safePage - 1)} disabled={safePage === 1}
                className="px-3 py-1.5 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹ 이전</button>
              {(() => {
                const half = 2;
                let start = Math.max(1, safePage - half);
                const end = Math.min(totalPages, start + 4);
                if (end - start < 4) start = Math.max(1, end - 4);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                  <button key={p} onClick={() => changePage(p)}
                    className={`min-w-[32px] px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                      p === safePage ? "bg-slate-700 text-white" : "text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                    }`}>{p}</button>
                ));
              })()}
              <button onClick={() => changePage(safePage + 1)} disabled={safePage === totalPages}
                className="px-3 py-1.5 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">다음 ›</button>
              <button onClick={() => changePage(totalPages)} disabled={safePage === totalPages}
                className="px-2 py-1.5 rounded text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">»</button>
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500">{safePage} / {totalPages} 페이지</span>
          </div>
        )}
      </div>

      {/* 상세 모달 */}
      {selected && !editPerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelected(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-800 dark:text-white">{selected.name}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{selected.dept} · {selected.rank}</p>
              </div>
              <div className="flex items-center gap-2">
                {meIsAdmin && (
                  <button type="button" onClick={() => openEditPerms(selected)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium">
                    권한 수정
                  </button>
                )}
                <button onClick={() => setSelected(null)} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {[
                ["사원번호", String(selected.id)],
                ["주민번호", selected.ssn ? maskSsn(selected.ssn) : "-"],
                ["자격증",   selected.cert ?? "-"],
                ["전화번호", selected.phone ?? "-"],
                ["입사일",   selected.hireDate ?? "-"],
                ["퇴사일",   selected.resignDate ?? "-"],
                ["재직상태", selected.status ?? "-"],
                ["주소",     selected.address ?? "-"],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <span className="text-gray-400 dark:text-gray-500 w-20 shrink-0">{label}</span>
                  <span className="text-gray-800 dark:text-gray-200 break-all">{value}</span>
                </div>
              ))}
              {(selected.permissions ?? []).length > 0 && (
                <div className="flex gap-3 pt-1">
                  <span className="text-gray-400 dark:text-gray-500 w-20 shrink-0">권한</span>
                  <div className="flex gap-1 flex-wrap">
                    <PermBadge perms={selected.permissions ?? []} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 권한 수정 모달 */}
      {editPerms && (
        <PermissionsModal
          user={editPerms}
          onClose={() => setEditPerms(null)}
          onSave={async (newPerms) => {
            try {
              const updated = await api.patch<UserRecord>(`/api/users/${editPerms.id}`, { permissions: newPerms });
              setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
              if (selected?.id === updated.id) setSelected(updated);
              setEditPerms(null);
            } catch (e) {
              alert(getErrorMessage(e));
            }
          }}
        />
      )}
    </>
  );
}
