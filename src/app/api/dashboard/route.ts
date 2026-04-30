import { NextResponse } from "next/server";
import { DashboardStats, RecentRequest } from "@/lib/types";

// DB 미연결 시 mock 데이터 반환
const MOCK_STATS: DashboardStats = {
  todayRequests: 7,
  pendingRequests: 3,
  lowStockMaterials: 5,
  totalMaterials: 248,
};

const MOCK_REQUESTS: RecentRequest[] = [
  { id: "1", materialName: "도어 클로저", siteName: "서울중앙빌딩", hoGiNo: "1호기", userName: "김철수", qty: 1, status: "pending", requestedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: "2", materialName: "안전스위치", siteName: "강남타워", hoGiNo: "3호기", userName: "이영희", qty: 2, status: "dispatched", requestedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
  { id: "3", materialName: "제어반 기판", siteName: "부산해운대빌딩", hoGiNo: "2호기", userName: "박민수", qty: 1, status: "pending", requestedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString() },
  { id: "4", materialName: "와이어 로프", siteName: "인천공항물류센터", hoGiNo: "5호기", userName: "최지영", qty: 1, status: "completed", requestedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString() },
  { id: "5", materialName: "가이드 슈", siteName: "서울중앙빌딩", hoGiNo: "2호기", userName: "김철수", qty: 4, status: "pending", requestedAt: new Date(Date.now() - 1000 * 60 * 240).toISOString() },
];

export async function GET() {
  try {
    // TODO: DB 연결 후 실제 데이터로 교체
    // const prisma = (await import("@/lib/prisma")).prisma;
    // const today = new Date(); today.setHours(0, 0, 0, 0);
    // const [todayRequests, pendingRequests, lowStockMaterials, totalMaterials, recentRequests] = await Promise.all([...]);
    return NextResponse.json({ stats: MOCK_STATS, recentRequests: MOCK_REQUESTS });
  } catch {
    return NextResponse.json({ error: "데이터 조회 실패" }, { status: 500 });
  }
}
