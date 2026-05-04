"use client";

import { useState, useMemo } from "react";
import { RecentRequest, RequestStatus } from "@/lib/types";
import TimeAgo from "./TimeAgo";

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending:    "대기",
  dispatched: "출고",
  completed:  "완료",
};

const STATUS_CLASS: Record<RequestStatus, string> = {
  pending:    "bg-yellow-100 text-yellow-700",
  dispatched: "bg-blue-100 text-blue-700",
  completed:  "bg-green-100 text-green-700",
};

type SortKey = "userName" | "siteName" | "hoGiNo" | "materialName" | "qty" | "status" | "requestedAt";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; sortable: boolean }[] = [
  { key: "userName",     label: "신청자", sortable: true  },
  { key: "siteName",     label: "현장",   sortable: true  },
  { key: "hoGiNo",       label: "호기",   sortable: true  },
  { key: "materialName", label: "자재명", sortable: true  },
  { key: "qty",          label: "수량",   sortable: true  },
  { key: "status",       label: "상태",   sortable: true  },
  { key: "requestedAt",  label: "시각",   sortable: true  },
];

const PAGE_SIZE = 20;

export default function RequestTable({ requests }: { requests: RecentRequest[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("requestedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  const sorted = useMemo(() => {
    const arr = [...requests];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), "ko");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [requests, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function changePage(next: number) {
    setPage(Math.max(1, Math.min(next, totalPages)));
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">최근 자재 신청</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          전체 {sorted.length.toLocaleString()}건
        </span>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-250px)]">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50">
          <tr>
            {COLUMNS.map(c => {
              const active = sortKey === c.key;
              return (
                <th key={c.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
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
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {paginated.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500 text-xs">
                신청 내역이 없습니다
              </td>
            </tr>
          ) : paginated.map(r => (
            <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.userName}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.siteName}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.hoGiNo}</td>
              <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{r.materialName}</td>
              <td className="px-4 py-3 text-gray-600 dark:text-gray-400 tabular-nums">{r.qty}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs"><TimeAgo iso={r.requestedAt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/60">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(safePage * PAGE_SIZE, sorted.length).toLocaleString()} / {sorted.length.toLocaleString()}건
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => changePage(1)} disabled={safePage === 1}
              className="px-2 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">«</button>
            <button onClick={() => changePage(safePage - 1)} disabled={safePage === 1}
              className="px-3 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">‹ 이전</button>
            {(() => {
              const half = 2;
              let start = Math.max(1, safePage - half);
              const end = Math.min(totalPages, start + 4);
              if (end - start < 4) start = Math.max(1, end - 4);
              return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                <button key={p} onClick={() => changePage(p)}
                  className={`min-w-[32px] px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                    p === safePage
                      ? "bg-slate-700 text-white"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}>{p}</button>
              ));
            })()}
            <button onClick={() => changePage(safePage + 1)} disabled={safePage === totalPages}
              className="px-3 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">다음 ›</button>
            <button onClick={() => changePage(totalPages)} disabled={safePage === totalPages}
              className="px-2 py-1.5 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">»</button>
          </div>
          <span className="text-xs text-gray-400 dark:text-gray-500">{safePage} / {totalPages} 페이지</span>
        </div>
      )}
    </div>
  );
}
