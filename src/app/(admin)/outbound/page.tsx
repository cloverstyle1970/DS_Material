import { getTransactions } from "@/lib/mock-transactions";
import { getSites } from "@/lib/mock-sites";
import StockHistoryClient from "@/components/stock/StockHistoryClient";

export default function OutboundPage() {
  const transactions = getTransactions("출고");
  const sites = getSites().map(s => ({ id: s.id, name: s.name }));
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">출고 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">자재 출고 등록 및 이력 조회</p>
      </div>
      <StockHistoryClient mode="출고" initial={transactions} sites={sites} />
    </div>
  );
}
