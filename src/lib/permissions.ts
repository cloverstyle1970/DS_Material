export interface PermissionMenuItem {
  href: string;
  label: string;
}

export interface PermissionMenuGroup {
  group: string;
  items: PermissionMenuItem[];
}

export const PERMISSION_MENUS: PermissionMenuGroup[] = [
  {
    group: "데이터관리",
    items: [
      { href: "/data/users",        label: "사원 관리" },
      { href: "/data/company-info", label: "회사 정보 관리" },
    ],
  },
  {
    group: "현장관리",
    items: [
      { href: "/site/units",   label: "현장/호기 관리" },
      { href: "/data/vendors", label: "거래처 관리" },
    ],
  },
  {
    group: "견적관리",
    items: [
      { href: "/quotes",             label: "견적서 목록" },
      { href: "/quotes/new",         label: "견적서 작성" },
      { href: "/quotes/labor-rates", label: "공정별 공수표" },
      { href: "/quotes/settings",    label: "견적 기본 설정" },
      { href: "/quotes/legacy",      label: "구 견적조회" },
    ],
  },
  {
    group: "자재관리",
    items: [
      { href: "/claim/new",            label: "견적 및 자재청구 등록" },
      { href: "/claim/quote-requests", label: "견적요청 목록" },
      { href: "/material",         label: "자재품목 관리" },
      { href: "/requests",         label: "자재 신청 관리" },
      { href: "/purchase-orders",  label: "발주 관리" },
      { href: "/inbound",          label: "입고 관리" },
      { href: "/outbound",         label: "출고 관리" },
      { href: "/returns",          label: "회수/반납 관리" },
      { href: "/serial-history",   label: "S/N 이력 추적" },
      { href: "/stats/period",     label: "기간별 입출고 내역" },
      { href: "/stats/sites",      label: "현장/호기별 현황" },
      { href: "/stats/performance", label: "사원 실적 (매출)" },
      { href: "/inventory-check",  label: "재고실사" },
    ],
  },
  {
    group: "공사일정",
    items: [
      { href: "/construction/schedule", label: "일정 캘린더" },
      { href: "/construction/requests", label: "공사 요청" },
    ],
  },
  {
    group: "산업안전",
    items: [
      { href: "/safety/tbm",          label: "TBM등록" },
      { href: "/safety/tbm/admin",    label: "TBM 관리(PC)" },
      { href: "/safety/tbm/master",   label: "TBM 마스터(PC)" },
      { href: "/uniform-safety",      label: "근무복·안전장구 신청" },
      { href: "/uniform-safety/admin", label: "근무복·안전장구 관리" },
    ],
  },
  {
    group: "관리/인사",
    items: [
      { href: "/hr/company-vehicles",  label: "회사차량관리" },
      { href: "/hr/employee-register", label: "사원등록" },
      { href: "/hr/dept-rank",         label: "부서/직급관리" },
      { href: "/hr/team-crew",         label: "팀구성 관리" },
    ],
  },
  {
    group: "회계/세무",
    items: [
      { href: "/payroll/payslip", label: "급여명세표" },
    ],
  },
];

const ALL_HREFS: string[] = PERMISSION_MENUS.flatMap(g => g.items.map(i => i.href));

/**
 * 현재 pathname이 어떤 메뉴 항목 아래에 속하는지 가장 긴 prefix로 매칭.
 * /requests/new → /requests, /data/vendors/123 → /data/vendors
 * 매칭되지 않으면 null (메뉴 외 페이지: dashboard, settings 등)
 */
export function matchMenuHref(pathname: string): string | null {
  let bestMatch: string | null = null;
  for (const href of ALL_HREFS) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!bestMatch || href.length > bestMatch.length) {
        bestMatch = href;
      }
    }
  }
  return bestMatch;
}
