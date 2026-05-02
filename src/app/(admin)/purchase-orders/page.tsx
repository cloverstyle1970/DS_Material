import RequestsClient from "@/components/requests/RequestsClient";

export default function PurchaseOrdersPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">발주 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">발주 내역 조회 및 신규 발주 등록</p>
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
