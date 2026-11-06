"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import Header from "@/components/layout/Header";
import StatCard from "@/components/dashboard/StatCard";
import { DashboardStats } from "@/lib/types";
import { fmtNum } from "@/lib/format";
import { useViewMode } from "@/context/ViewModeContext";
import { useReloadOnActivate } from "@/context/TabActivationContext";

const EMPTY_STATS: DashboardStats = {
  todayRequests: 0,
  pendingRequests: 0,
  lowStockMaterials: 0,
  totalMaterials: 0,
  totalSites: 0,
  tkeSites: 0,
  dsSites: 0,
  etcSites: 0,
  totalElevators: 0,
  tkeElevators: 0,
  dsElevators: 0,
  otherElevators: 0,
};

export default function DashboardContent() {
  const { viewMode } = useViewMode();
  const isMobile = viewMode === "mobile";
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);

  const loadStats = () => {
    api.get<{ stats: DashboardStats }>("/api/dashboard")
      .then(d => setStats(d.stats))
      .catch(() => {});
  };
  useEffect(() => {
    loadStats();
  }, []);
  useReloadOnActivate(loadStats);

  return (
    <>
      <Header title="대시보드" />
      <main className="flex-1 p-6 space-y-8 bg-gray-50 dark:bg-gray-900 overflow-y-auto">
        <section>
          <h2 className="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100 mb-4">
            현장 관련 정보
          </h2>
          <div className={`grid gap-4 ${isMobile ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-4"}`}>
            {/* 전체 */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm flex flex-col gap-2">
              <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">전체</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{fmtNum(stats.totalSites)}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">개소</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold text-slate-600 dark:text-slate-300 tabular-nums">{fmtNum(stats.totalElevators)}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">대</span>
              </div>
            </div>
            {/* TK */}
            <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-5 shadow-sm flex flex-col gap-2">
              <span className="inline-flex self-start text-xs font-bold px-2 py-0.5 rounded bg-blue-600 text-white">TK</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-blue-800 dark:text-blue-200 tabular-nums">{fmtNum(stats.tkeSites)}</span>
                <span className="text-sm text-blue-600 dark:text-blue-400">개소</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold text-blue-700 dark:text-blue-300 tabular-nums">{fmtNum(stats.tkeElevators)}</span>
                <span className="text-sm text-blue-600 dark:text-blue-400">대</span>
              </div>
            </div>
            {/* DS */}
            <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-5 shadow-sm flex flex-col gap-2">
              <span className="inline-flex self-start text-xs font-bold px-2 py-0.5 rounded bg-red-500 text-white">DS</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-red-800 dark:text-red-200 tabular-nums">{fmtNum(stats.dsSites)}</span>
                <span className="text-sm text-red-600 dark:text-red-400">개소</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold text-red-700 dark:text-red-300 tabular-nums">{fmtNum(stats.dsElevators)}</span>
                <span className="text-sm text-red-600 dark:text-red-400">대</span>
              </div>
            </div>
            {/* 기타 */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-5 shadow-sm flex flex-col gap-2">
              <span className="inline-flex self-start text-xs font-bold px-2 py-0.5 rounded bg-slate-400 text-white dark:bg-slate-500">기타</span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-700 dark:text-slate-200 tabular-nums">{fmtNum(stats.etcSites)}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">개소</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold text-slate-600 dark:text-slate-300 tabular-nums">{fmtNum(stats.otherElevators)}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">대</span>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100 mb-4">
            자재 수급 현황
          </h2>
          <div className={`grid gap-4 ${isMobile ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"}`}>
            <StatCard label="오늘 신청"      value={stats.todayRequests}     color="blue"   />
            <StatCard label="미출고 건"      value={stats.pendingRequests}   color="orange" />
            <StatCard label="재고 없는 자재" value={stats.lowStockMaterials} unit="종" color="red"   />
            <StatCard label="전체 자재"      value={stats.totalMaterials}    unit="종" color="green" />
          </div>
        </section>
      </main>
    </>
  );
}
