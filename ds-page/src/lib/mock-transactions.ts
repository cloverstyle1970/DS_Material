import { getMaterials, updateStock } from "./mock-materials";

export interface TransactionRecord {
  id: number;
  type: "입고" | "출고";
  materialId: string;
  materialName: string;
  qty: number;
  prevStock: number;
  afterStock: number;
  siteName: string | null;
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
  note: string | null;
  userId: number;
  userName: string;
}

export function addTransaction(data: AddTransactionInput): { record: TransactionRecord; error?: string } {
  const material = getMaterials().find(m => m.id === data.materialId);
  if (!material) return { record: null as never, error: "자재를 찾을 수 없습니다." };

  const prevStock = material.stockQty;
  const afterStock = data.type === "입고" ? prevStock + data.qty : prevStock - data.qty;

  if (afterStock < 0) {
    return { record: null as never, error: `재고 부족 (현재 재고: ${prevStock})` };
  }

  updateStock(data.materialId, afterStock);

  const record: TransactionRecord = {
    id: nextId++,
    ...data,
    prevStock,
    afterStock,
    createdAt: new Date().toISOString(),
  };
  transactions.push(record);
  return { record };
}
