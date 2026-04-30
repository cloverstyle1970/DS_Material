export type RequestStatus = "신청" | "처리중" | "완료" | "취소";

export interface MaterialRequestItem {
  materialId: string;
  materialName: string;
  qty: number;
  elevatorName: string | null;
}

export interface MaterialRequestRecord {
  id: number;
  status: RequestStatus;
  siteName: string | null;
  items: MaterialRequestItem[];
  note: string | null;
  requesterId: number;
  requesterName: string;
  requesterDept: string;
  requestedAt: string;
  processedAt: string | null;
  processorId: number | null;
  processorName: string | null;
}

let records: MaterialRequestRecord[] = [];

function nextId(): number {
  return records.length === 0 ? 1 : Math.max(...records.map(r => r.id)) + 1;
}

export function getMaterialRequests(status?: string): MaterialRequestRecord[] {
  const result = [...records].reverse();
  if (status) return result.filter(r => r.status === status);
  return result;
}

export function addMaterialRequest(
  data: Omit<MaterialRequestRecord, "id" | "status" | "requestedAt" | "processedAt" | "processorId" | "processorName">
): MaterialRequestRecord {
  const record: MaterialRequestRecord = {
    ...data,
    id: nextId(),
    status: "신청",
    requestedAt: new Date().toISOString(),
    processedAt: null,
    processorId: null,
    processorName: null,
  };
  records.push(record);
  return record;
}

export function updateMaterialRequest(
  id: number,
  patch: Partial<MaterialRequestRecord>
): MaterialRequestRecord | null {
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], ...patch };
  return records[idx];
}
