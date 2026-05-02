import StockHistoryClient from "@/components/stock/StockHistoryClient";

export default function InboundPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">입고 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">자재 입고 등록 및 이력 조회</p>
      </div>
      <StockHistoryClient mode="입고" initial={[]} />
    </div>
  );
}
