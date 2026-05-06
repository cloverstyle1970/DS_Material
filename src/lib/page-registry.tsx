import { ReactNode } from "react";

import DashboardContent from "@/components/dashboard/DashboardContent";
import SettingsContent from "@/components/settings/SettingsContent";
import UsersClient from "@/components/users/UsersClient";
import VendorsClient from "@/components/vendors/VendorsClient";
import SitesClient from "@/components/sites/SitesClient";
import Header from "@/components/layout/Header";
import MaterialsClient from "@/components/materials/MaterialsClient";
import RequestsClient from "@/components/requests/RequestsClient";
import StockHistoryClient from "@/components/stock/StockHistoryClient";
import ReturnsClient from "@/components/returns/ReturnsClient";
import SerialHistoryClient from "@/components/serial-history/SerialHistoryClient";
import PeriodStatsClient from "@/components/stats/PeriodStatsClient";
import SiteStatsClient from "@/components/stats/SiteStatsClient";
import InventoryCheckClient from "@/components/materials/InventoryCheckClient";
import ConstructionCalendarClient from "@/components/construction/ConstructionCalendarClient";
import ConstructionRequestClient from "@/components/construction/ConstructionRequestClient";

export interface PageEntry {
  label: string;
  render: () => ReactNode;
}

export const PAGE_REGISTRY: Record<string, PageEntry> = {
  "/dashboard": {
    label: "대시보드",
    render: () => <DashboardContent />,
  },
  "/data/users": {
    label: "사용자 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">사용자 관리</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">사원 명부 및 시스템 접근 계정 관리</p>
        </div>
        <UsersClient initial={[]} />
      </div>
    ),
  },
  "/data/vendors": {
    label: "거래처 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">거래처 관리</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">협력 거래처 목록 조회 및 정보 관리</p>
        </div>
        <VendorsClient initial={[]} />
      </div>
    ),
  },
  "/site/units": {
    label: "현장/호기 관리",
    render: () => <SitesClient initial={[]} elevators={[]} />,
  },
  "/material": {
    label: "자재품목 관리",
    render: () => (
      <>
        <Header title="자재관리" />
        <main className="flex-1 p-6 space-y-4">
          <MaterialsClient initial={[]} />
        </main>
      </>
    ),
  },
  "/requests": {
    label: "자재 신청 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">자재 신청 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">현장 자재 신청 내역 조회 및 처리</p>
        </div>
        <RequestsClient
          initialRequests={[]}
          initialOrders={[]}
          initialInbound={[]}
          initialOutbound={[]}
          mode="requests-only"
        />
      </div>
    ),
  },
  "/purchase-orders": {
    label: "발주 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">발주 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">발주 내역 조회 및 신규 발주 등록</p>
        </div>
        <RequestsClient
          initialRequests={[]}
          initialOrders={[]}
          initialInbound={[]}
          initialOutbound={[]}
          mode="orders-only"
        />
      </div>
    ),
  },
  "/inbound": {
    label: "입고 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">입고 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">자재 입고 등록 및 이력 조회</p>
        </div>
        <StockHistoryClient mode="입고" initial={[]} />
      </div>
    ),
  },
  "/outbound": {
    label: "출고 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">출고 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">자재 출고 등록 및 이력 조회</p>
        </div>
        <StockHistoryClient mode="출고" initial={[]} />
      </div>
    ),
  },
  "/returns": {
    label: "회수/반납 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">회수/반납 관리</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">출고 시 회수 표시된 자재의 반납 등록</p>
        </div>
        <ReturnsClient />
      </div>
    ),
  },
  "/serial-history": {
    label: "S/N 이력 추적",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">S/N 이력 추적</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">S/N 단위 자재 인스턴스의 입고·출고·회수·반납 타임라인 조회</p>
        </div>
        <SerialHistoryClient />
      </div>
    ),
  },
  "/stats/period": {
    label: "기간별 입출고 내역",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">기간별 입출고 내역</h1>
          <p className="text-sm text-gray-500 mt-0.5">월별/분기별/연도별 입고·출고 추이 분석</p>
        </div>
        <PeriodStatsClient />
      </div>
    ),
  },
  "/stats/sites": {
    label: "현장/호기별 현황",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">현장/호기별 투입 현황</h1>
          <p className="text-sm text-gray-500 mt-0.5">현장별·자재별 입출고 집계 및 분석</p>
        </div>
        <SiteStatsClient />
      </div>
    ),
  },
  "/inventory-check": {
    label: "재고실사",
    render: () => (
      <>
        <Header title="재고실사" />
        <main className="flex-1 p-6 space-y-4">
          <InventoryCheckClient />
        </main>
      </>
    ),
  },
  "/construction/schedule": {
    label: "일정 캘린더",
    render: () => <ConstructionCalendarClient />,
  },
  "/construction/requests": {
    label: "공사 요청",
    render: () => <ConstructionRequestClient />,
  },
  "/settings": {
    label: "환경설정",
    render: () => <SettingsContent />,
  },
};

export function getPageEntry(href: string): PageEntry | null {
  return PAGE_REGISTRY[href] ?? null;
}

export function getTabLabel(href: string): string {
  return PAGE_REGISTRY[href]?.label ?? href;
}
