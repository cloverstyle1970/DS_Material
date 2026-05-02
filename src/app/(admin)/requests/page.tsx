import RequestsClient from "@/components/requests/RequestsClient";

export default function RequestsPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">자재 신청 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">현장 자재 신청 내역 조회 및 처리</p>
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
