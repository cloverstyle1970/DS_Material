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
          <div className={`grid gap-4 ${isMobile ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"}`}>
            <StatCard label="총 유지보수 현장" value={stats.totalSites} unit="곳" color="blue" />
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 flex flex-col justify-center shadow-sm">
               <div className="flex justify-between items-center mb-3">
                 <span className="text-sm font-medium text-slate-500 dark:text-slate-400">TK 현장</span>
                 <span className="font-bold text-slate-800 dark:text-slate-100">{fmtNum(stats.tkeSites)}곳</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-sm font-medium text-slate-500 dark:text-slate-400">DS 현장</span>
                 <span className="font-bold text-slate-800 dark:text-slate-100">{fmtNum(stats.dsSites)}곳</span>
               </div>
            </div>
            <StatCard label="유지보수 대수" value={stats.totalElevators} unit="대" color="green" />
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 flex flex-col justify-center shadow-sm">
               <div className="space-y-3">
                 {[
                   { label: "TK",   value: stats.tkeElevators },
                   { label: "DS",   value: stats.dsElevators },
                   { label: "기타", value: stats.otherElevators },
                 ].map(row => (
                   <div key={row.label} className="flex justify-between items-center">
                     <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{row.label}</span>
                     <span className="font-bold text-slate-800 dark:text-slate-100 tabular-nums whitespace-nowrap">{fmtNum(row.value)}대</span>
                   </div>
                 ))}
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
