export type RequestStatus = "pending" | "dispatched" | "completed";
export type UserRole = "admin" | "engineer";

export interface DashboardStats {
  todayRequests: number;
  pendingRequests: number;
  lowStockMaterials: number;
  totalMaterials: number;
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
