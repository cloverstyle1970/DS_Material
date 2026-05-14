import StockHistoryClient from "@/components/stock/StockHistoryClient";

export default function OutboundPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
        <span className="w-1.5 h-9 rounded-full bg-orange-500"></span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-black dark:text-white">출고 관리</h1>
          <p className="text-sm font-medium text-black dark:text-white mt-0.5">자재 출고 등록 및 이력 조회</p>
        </div>
      </div>
      <StockHistoryClient mode="출고" initial={[]} />
    </div>
  );
}
