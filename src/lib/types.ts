export type RequestStatus = "pending" | "dispatched" | "completed";
export type UserRole = "admin" | "engineer";

export interface DashboardStats {
  todayRequests: number;
  pendingRequests: number;
  lowStockMaterials: number;
  totalMaterials: number;
  
  // 현장 및 기종 통계 추가
  totalSites: number;
  tkeSites: number;
  dsSites: number;
  
  totalElevators: number;
  tkeElevators: number;
  hyundaiElevators: number;
  otisElevators: number;
  otherElevators: number;
}

export interface RecentRequest {
  id: string;
  materialName: string;
  siteName: string;
  hoGiNo: string;
  userName: string;
  qty: number;
  status: RequestStatus;
  requestedAt: string;
}
