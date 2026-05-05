export type MaterialUnitStatus = "재고" | "출고" | "반납대기" | "반납완료" | "폐기";

export interface MaterialUnitRecord {
  id: number;
  materialId: string;
  serialNo: string;
  status: MaterialUnitStatus;
  currentSite: string | null;
  currentElevator: string | null;
  inboundAt: string;
  lastEventAt: string;
  createdAt: string;
}
