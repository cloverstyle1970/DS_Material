import { adjustStock } from "./mock-materials";

export interface TransactionRecord {
  id: number;
  type: "입고" | "출고";
  materialId: string;
  materialName: string;
  qty: number;
  prevStock: number;
  afterStock: number;
  siteName: string | null;
  elevatorName: string | null;
  serialNo: string | null;
  requiresReturn: boolean;
  returnStatus: "pending" | "returned" | null;
  returnedAt: string | null;
  returnedByUserId: number | null;
  returnedByUserName: string | null;
  materialUnitId: number | null;
  note: string | null;
  userId: number;
  userName: string;
  createdAt: string;
}

const transactions: TransactionRecord[] = [];
let nextId = 1;

export function getTransactions(type?: string): TransactionRecord[] {
  const result = [...transactions].reverse();
  if (type === "입고" || type === "출고") return result.filter(t => t.type === type);
  return result;
}

export interface AddTransactionInput {
  type: "입고" | "출고";
  materialId: string;
  materialName: string;
  qty: number;
  siteName: string | null;
  elevatorName?: string | null;
  serialNo?: string | null;
  requiresReturn?: boolean;
  note: string | null;
  userId: number;
  userName: string;
}

/**
 * 트랜잭션 기록 + 재고 갱신을 단일 동기 블록 안에서 처리.
 * adjustStock이 검증과 갱신을 한 호출로 묶어 race를 차단한다.
 * (호출부는 absolutely no-await 보장 — async 흐름 사이에 끼우지 말 것.)
 */
export function addTransaction(data: AddTransactionInput): { record?: TransactionRecord; error?: string } {
  const delta = data.type === "입고" ? data.qty : -data.qty;
  const result = adjustStock(data.materialId, delta);

  if (result.error === "NOT_FOUND")    return { error: "자재를 찾을 수 없습니다." };
  if (result.error === "INSUFFICIENT") return { error: `재고 부족 (현재 재고: ${result.prevStock})` };

  const record: TransactionRecord = {
    id: nextId++,
    type:               data.type,
    materialId:         data.materialId,
    materialName:       data.materialName,
    qty:                data.qty,
    siteName:           data.siteName,
    elevatorName:       data.elevatorName ?? null,
    serialNo:           data.serialNo ?? null,
    requiresReturn:     data.requiresReturn ?? false,
    returnStatus:       data.requiresReturn && data.type === "출고" ? "pending" : null,
    returnedAt:         null,
    returnedByUserId:   null,
    returnedByUserName: null,
    materialUnitId:     null,
    note:               data.note,
    userId:             data.userId,
    userName:           data.userName,
    prevStock:          result.prevStock,
    afterStock:         result.afterStock,
    createdAt:          new Date().toISOString(),
  };
  transactions.push(record);
  return { record };
}
