import StockHistoryClient from "@/components/stock/StockHistoryClient";

export default function OutboundPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">출고 관리</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">자재 출고 등록 및 이력 조회</p>
      </div>
      <StockHistoryClient mode="출고" initial={[]} />
    </div>
  );
}
