import Header from "@/components/layout/Header";
import StatCard from "@/components/dashboard/StatCard";
import RequestTable from "@/components/dashboard/RequestTable";
import { DashboardStats, RecentRequest } from "@/lib/types";

async function getDashboardData(): Promise<{ stats: DashboardStats; recentRequests: RecentRequest[] }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/dashboard`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("대시보드 데이터 조회 실패");
  return res.json();
}

export default async function DashboardPage() {
  const { stats, recentRequests } = await getDashboardData();

  return (
    <>
      <Header title="대시보드" />
      <main className="flex-1 p-6 space-y-6 bg-gray-50 dark:bg-gray-900">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label="오늘 신청" value={stats.todayRequests} color="blue" />
          <StatCard label="미출고 건" value={stats.pendingRequests} color="orange" />
          <StatCard label="재고 부족 자재" value={stats.lowStockMaterials} unit="종" color="red" />
          <StatCard label="전체 자재" value={stats.totalMaterials} unit="종" color="green" />
        </div>
        <RequestTable requests={recentRequests} />
      </main>
    </>
  );
}
