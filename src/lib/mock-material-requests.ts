import fs from "fs";
import path from "path";

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

const FILE = path.join(process.cwd(), "data", "material-requests.json");

function load(): MaterialRequestRecord[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch {
    return [];
  }
}

function save(records: MaterialRequestRecord[]) {
  fs.writeFileSync(FILE, JSON.stringify(records, null, 2), "utf-8");
}

function nextId(records: MaterialRequestRecord[]): number {
  return records.length === 0 ? 1 : Math.max(...records.map(r => r.id)) + 1;
}

export function getMaterialRequests(status?: string): MaterialRequestRecord[] {
  const records = load();
  const result = [...records].reverse();
  if (status) return result.filter(r => r.status === status);
  return result;
}

export function addMaterialRequest(
  data: Omit<MaterialRequestRecord, "id" | "status" | "requestedAt" | "processedAt" | "processorId" | "processorName">
): MaterialRequestRecord {
  const records = load();
  const record: MaterialRequestRecord = {
    ...data,
    id: nextId(records),
    status: "신청",
    requestedAt: new Date().toISOString(),
    processedAt: null,
    processorId: null,
    processorName: null,
  };
  records.push(record);
  save(records);
  return record;
}

export function updateMaterialRequest(
  id: number,
  patch: Partial<MaterialRequestRecord>
): MaterialRequestRecord | null {
  const records = load();
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], ...patch };
  save(records);
  return records[idx];
}
