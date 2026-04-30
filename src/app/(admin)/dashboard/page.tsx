import Header from "@/components/layout/Header";
import StatCard from "@/components/dashboard/StatCard";
import RequestTable from "@/components/dashboard/RequestTable";
import { DashboardStats, RecentRequest } from "@/lib/types";

const MOCK_STATS: DashboardStats = {
  todayRequests: 7,
  pendingRequests: 3,
  lowStockMaterials: 5,
  totalMaterials: 248,
};

const MOCK_REQUESTS: RecentRequest[] = [
  { id: "1", materialName: "도어 클로저",  siteName: "서울중앙빌딩",     hoGiNo: "1호기", userName: "김철수", qty: 1, status: "pending",    requestedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: "2", materialName: "안전스위치",   siteName: "강남타워",         hoGiNo: "3호기", userName: "이영희", qty: 2, status: "dispatched", requestedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
  { id: "3", materialName: "제어반 기판",  siteName: "부산해운대빌딩",   hoGiNo: "2호기", userName: "박민수", qty: 1, status: "pending",    requestedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString() },
  { id: "4", materialName: "와이어 로프",  siteName: "인천공항물류센터", hoGiNo: "5호기", userName: "최지영", qty: 1, status: "completed",  requestedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString() },
  { id: "5", materialName: "가이드 슈",    siteName: "서울중앙빌딩",     hoGiNo: "2호기", userName: "김철수", qty: 4, status: "pending",    requestedAt: new Date(Date.now() - 1000 * 60 * 240).toISOString() },
];

export default function DashboardPage() {
  return (
    <>
      <Header title="대시보드" />
      <main className="flex-1 p-6 space-y-6 bg-gray-50 dark:bg-gray-900">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label="오늘 신청"     value={MOCK_STATS.todayRequests}     color="blue"   />
          <StatCard label="미출고 건"     value={MOCK_STATS.pendingRequests}   color="orange" />
          <StatCard label="재고 부족 자재" value={MOCK_STATS.lowStockMaterials} unit="종" color="red"   />
          <StatCard label="전체 자재"     value={MOCK_STATS.totalMaterials}    unit="종" color="green" />
        </div>
        <RequestTable requests={MOCK_REQUESTS} />
      </main>
    </>
  );
}
