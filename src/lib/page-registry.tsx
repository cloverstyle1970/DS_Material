import { ReactNode } from "react";

import DashboardContent from "@/components/dashboard/DashboardContent";
import MyDashboardContent from "@/components/me/MyDashboardContent";
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
import TBMClient from "@/components/tbm/TBMClient";
import TBMAdminClient from "@/components/tbm/TBMAdminClient";
import TBMMasterClient from "@/components/tbm/TBMMasterClient";
import EmployeeRegisterClient from "@/components/hr/EmployeeRegisterClient";
import ClaimEntryClient from "@/components/claim/ClaimEntryClient";
import QuoteRequestsListClient from "@/components/claim/QuoteRequestsListClient";
import QuoteOutboundClient from "@/components/claim/QuoteOutboundClient";
import DeliveryNoteClient from "@/components/invoice/DeliveryNoteClient";
import TaxInvoiceClient from "@/components/invoice/TaxInvoiceClient";
import PerformanceStatsClient from "@/components/stats/PerformanceStatsClient";
import DeptRankClient from "@/components/hr/DeptRankClient";
import TeamCrewClient from "@/components/hr/TeamCrewClient";
import CompanyVehiclesClient from "@/components/hr/CompanyVehiclesClient";
import TransferClient from "@/components/hr/TransferClient";
import EmploymentStatusClient from "@/components/hr/EmploymentStatusClient";
import RewardsPunishmentsClient from "@/components/hr/RewardsPunishmentsClient";
import MyProfileClient from "@/components/data/MyProfileClient";
import CompanyInfoClient from "@/components/data/CompanyInfoClient";
import PermissionGroupsClient from "@/components/data/PermissionGroupsClient";
import UniformSafetyClient from "@/components/uniform-safety/UniformSafetyClient";
import UniformSafetyAdminClient from "@/components/uniform-safety/UniformSafetyAdminClient";
import QuoteEntryClient from "@/components/quotes/QuoteEntryClient";
import QuoteSettingsClient from "@/components/quotes/QuoteSettingsClient";
import QuotesListClient from "@/components/quotes/QuotesListClient";
import LaborRatesClient from "@/components/quotes/LaborRatesClient";
import QuoteDetailClient from "@/components/quotes/QuoteDetailClient";
import LegacyQuotesClient from "@/components/quotes/LegacyQuotesClient";
import PayslipClient from "@/components/payroll/PayslipClient";
import ManualCenterClient from "@/components/manual/ManualCenterClient";
import ImprovementRequestsClient from "@/components/board/ImprovementRequestsClient";

export interface PageEntry {
  label: string;
  render: () => ReactNode;
}

export const PAGE_REGISTRY: Record<string, PageEntry> = {
  "/dashboard": {
    label: "대시보드",
    render: () => <DashboardContent />,
  },
  "/me": {
    label: "내 대시보드",
    render: () => <MyDashboardContent />,
  },
  "/safety/tbm": {
    label: "TBM",
    render: () => <TBMClient />,
  },
  "/safety/tbm/admin": {
    label: "TBM 관리",
    render: () => <TBMAdminClient />,
  },
  "/safety/tbm/master": {
    label: "TBM 마스터",
    render: () => <TBMMasterClient />,
  },
  "/hr/employee-register": {
    label: "사원등록",
    render: () => <EmployeeRegisterClient />,
  },
  "/hr/dept-rank": {
    label: "부서/직급관리",
    render: () => <DeptRankClient />,
  },
  "/hr/team-crew": {
    label: "팀구성 관리",
    render: () => <TeamCrewClient />,
  },
  "/hr/company-vehicles": {
    label: "회사차량관리",
    render: () => <CompanyVehiclesClient />,
  },
  "/hr/transfer": {
    label: "인사 이동",
    render: () => <TransferClient />,
  },
  "/hr/employment-status": {
    label: "재직상태 관리",
    render: () => <EmploymentStatusClient />,
  },
  "/hr/rewards-punishments": {
    label: "상벌사항 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">상벌사항 관리</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">사원 상벌 이력 등록·수정·삭제</p>
        </div>
        <RewardsPunishmentsClient />
      </div>
    ),
  },
  "/uniform-safety": {
    label: "근무복·안전장구 신청",
    render: () => <UniformSafetyClient />,
  },
  "/uniform-safety/admin": {
    label: "근무복·안전장구 관리",
    render: () => <UniformSafetyAdminClient />,
  },
  "/quotes": {
    label: "견적서 목록",
    render: () => <QuotesListClient />,
  },
  "/quotes/new": {
    label: "견적서 작성",
    render: () => <QuoteEntryClient />,
  },
  "/quotes/edit": {
    label: "견적서 수정",
    render: () => <QuoteEntryClient />,
  },
  "/quotes/detail": {
    label: "견적서 상세",
    render: () => <QuoteDetailClient />,
  },
  "/quotes/labor-rates": {
    label: "공정별 공수표",
    render: () => <LaborRatesClient />,
  },
  "/quotes/settings": {
    label: "견적 기본 설정",
    render: () => <QuoteSettingsClient />,
  },
  "/quotes/legacy": {
    label: "구 견적조회",
    render: () => <LegacyQuotesClient />,
  },
  "/payroll/payslip": {
    label: "급여명세표",
    render: () => <PayslipClient />,
  },
  "/data/profile": {
    label: "개인정보수정",
    render: () => <MyProfileClient />,
  },
  "/manual": {
    label: "도움말 센터",
    render: () => <ManualCenterClient />,
  },
  "/data/company-info": {
    label: "회사 정보 관리",
    render: () => <CompanyInfoClient />,
  },
  "/data/permission-groups": {
    label: "사용자권한그룹",
    render: () => <PermissionGroupsClient />,
  },
  "/data/users": {
    label: "사원 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">사원 관리</h1>
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
  "/claim/new": {
    label: "견적 및 자재청구 등록",
    render: () => <ClaimEntryClient />,
  },
  "/claim/quote-requests": {
    label: "견적요청 목록",
    render: () => <QuoteRequestsListClient />,
  },
  "/claim/quote-outbound": {
    label: "견적 출고 관리",
    render: () => <QuoteOutboundClient />,
  },
  "/invoice/delivery": {
    label: "거래명세서",
    render: () => <DeliveryNoteClient />,
  },
  "/invoice/tax": {
    label: "세금계산서",
    render: () => <TaxInvoiceClient />,
  },
  "/requests": {
    label: "자재 신청 관리",
    render: () => (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">자재 신청 관리</h1>
          <p className="text-sm text-gray-500 dark:text-gray-300 mt-0.5">현장 자재 신청 내역 조회 및 처리</p>
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
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">발주 관리</h1>
          <p className="text-sm text-gray-500 dark:text-gray-300 mt-0.5">발주 내역 조회 및 신규 발주 등록</p>
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
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">입고 관리</h1>
          <p className="text-sm text-gray-500 dark:text-gray-300 mt-0.5">자재 입고 등록 및 이력 조회</p>
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
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">출고 관리</h1>
          <p className="text-sm text-gray-500 dark:text-gray-300 mt-0.5">자재 출고 등록 및 이력 조회</p>
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
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">기간별 입출고 내역</h1>
          <p className="text-sm text-gray-500 dark:text-gray-300 mt-0.5">월별/분기별/연도별 입고·출고 추이 분석</p>
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
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white">현장/호기별 투입 현황</h1>
          <p className="text-sm text-gray-500 dark:text-gray-300 mt-0.5">현장별·자재별 입출고 집계 및 분석</p>
        </div>
        <SiteStatsClient />
      </div>
    ),
  },
  "/stats/performance": {
    label: "사원 실적 (매출)",
    render: () => <PerformanceStatsClient />,
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
  "/board/improvements": {
    label: "개선요청",
    render: () => <ImprovementRequestsClient />,
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
