"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import Header from "@/components/layout/Header";
import StatCard from "@/components/dashboard/StatCard";
import RequestTable from "@/components/dashboard/RequestTable";
import { DashboardStats, RecentRequest } from "@/lib/types";

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
  hyundaiElevators: 0,
  otisElevators: 0,
  otherElevators: 0,
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [requests, setRequests] = useState<RecentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ stats: DashboardStats; recentRequests: RecentRequest[] }>("/api/dashboard")
      .then(d => {
        setStats(d.stats);
        setRequests(d.recentRequests);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Header title="대시보드" />
      <main className="flex-1 p-6 space-y-8 bg-gray-50 dark:bg-gray-900 overflow-y-auto">
        
        {/* 현장 및 호기 통계 섹션 */}
        <section>
          <h2 className="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100 mb-4">
            현장 관련 정보
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
            {/* 유지보수 현장 수 */}
            <StatCard label="총 유지보수 현장" value={stats.totalSites} unit="곳" color="blue" />
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 flex flex-col justify-center shadow-sm">
               <div className="flex justify-between items-center mb-3">
                 <span className="text-sm font-medium text-slate-500 dark:text-slate-400">TKE 현장</span>
                 <span className="font-bold text-slate-800 dark:text-slate-100">{stats.tkeSites.toLocaleString()}곳</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-sm font-medium text-slate-500 dark:text-slate-400">DS (대솔) 현장</span>
                 <span className="font-bold text-slate-800 dark:text-slate-100">{stats.dsSites.toLocaleString()}곳</span>
               </div>
            </div>
            
            {/* 기종별 수량 */}
            <StatCard label="총 유지보수 호기" value={stats.totalElevators} unit="대" color="green" />
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 flex flex-col justify-center shadow-sm xl:col-span-3">
               <div className="grid grid-cols-4 gap-4 text-center divide-x divide-slate-100 dark:divide-slate-700">
                 <div>
                   <div className="text-xs font-medium text-slate-400 mb-1">TKE</div>
                   <div className="font-bold text-lg text-slate-700 dark:text-slate-200">{stats.tkeElevators.toLocaleString()}대</div>
                 </div>
                 <div>
                   <div className="text-xs font-medium text-slate-400 mb-1">현대</div>
                   <div className="font-bold text-lg text-slate-700 dark:text-slate-200">{stats.hyundaiElevators.toLocaleString()}대</div>
                 </div>
                 <div>
                   <div className="text-xs font-medium text-slate-400 mb-1">OTIS</div>
                   <div className="font-bold text-lg text-slate-700 dark:text-slate-200">{stats.otisElevators.toLocaleString()}대</div>
                 </div>
                 <div>
                   <div className="text-xs font-medium text-slate-400 mb-1">기타</div>
                   <div className="font-bold text-lg text-slate-700 dark:text-slate-200">{stats.otherElevators.toLocaleString()}대</div>
                 </div>
               </div>
            </div>
          </div>
        </section>

        {/* 자재 통계 섹션 */}
        <section>
          <h2 className="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100 mb-4">
            자재 수급 현황
          </h2>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard label="오늘 신청"      value={stats.todayRequests}     color="blue"   />
            <StatCard label="미출고 건"      value={stats.pendingRequests}   color="orange" />
            <StatCard label="재고 없는 자재" value={stats.lowStockMaterials} unit="종" color="red"   />
            <StatCard label="전체 자재"      value={stats.totalMaterials}    unit="종" color="green" />
          </div>
        </section>
        {loading ? (
          <div className="text-center text-sm text-gray-500 py-8">불러오는 중...</div>
        ) : (
          <RequestTable requests={requests} />
        )}
      </main>
    </>
  );
}
