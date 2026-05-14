import RequestsClient from "@/components/requests/RequestsClient";

export default function PurchaseOrdersPage() {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
        <span className="w-1.5 h-9 rounded-full bg-blue-500"></span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-black dark:text-white">발주 관리</h1>
          <p className="text-sm font-medium text-black dark:text-white mt-0.5">발주 내역 조회 및 신규 발주 등록</p>
        </div>
      </div>
      <RequestsClient
        initialRequests={[]}
        initialOrders={[]}
        initialInbound={[]}
        initialOutbound={[]}
        mode="orders-only"
      />
    </div>
  );
}
