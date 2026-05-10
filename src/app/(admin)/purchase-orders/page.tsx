import RequestsClient from "@/components/requests/RequestsClient";

export default function PurchaseOrdersPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">발주 관리</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">발주 내역 조회 및 신규 발주 등록</p>
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
