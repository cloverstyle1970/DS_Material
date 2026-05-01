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
      <main className="flex-1 p-6 space-y-6 bg-gray-50 dark:bg-gray-900">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label="오늘 신청"      value={stats.todayRequests}     color="blue"   />
          <StatCard label="미출고 건"      value={stats.pendingRequests}   color="orange" />
          <StatCard label="재고 없는 자재" value={stats.lowStockMaterials} unit="종" color="red"   />
          <StatCard label="전체 자재"      value={stats.totalMaterials}    unit="종" color="green" />
        </div>
        {loading ? (
          <div className="text-center text-sm text-gray-500 py-8">불러오는 중...</div>
        ) : (
          <RequestTable requests={requests} />
        )}
      </main>
    </>
  );
}
