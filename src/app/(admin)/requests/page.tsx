import RequestsClient from "@/components/requests/RequestsClient";

export default function RequestsPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">자재 신청 관리</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">현장 자재 신청 내역 조회 및 처리</p>
      </div>
      <RequestsClient
        initialRequests={[]}
        initialOrders={[]}
        initialInbound={[]}
        initialOutbound={[]}
        mode="requests-only"
      />
    </div>
  );
}
