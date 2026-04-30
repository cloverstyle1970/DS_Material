import { getPurchaseOrders } from "@/lib/mock-purchase-orders";
import { getSites } from "@/lib/mock-sites";
import { getVendors } from "@/lib/mock-vendors";
import { getMaterialRequests } from "@/lib/mock-material-requests";
import RequestsClient from "@/components/requests/RequestsClient";

export default function PurchaseOrdersPage() {
  const orders    = getPurchaseOrders();
  const sites     = getSites().map(s => ({ id: s.id, name: s.name }));
  const vendors   = getVendors(undefined, "매입").map(v => ({ id: v.id, name: v.name }));
  const pending   = getMaterialRequests().filter(r => r.status === "신청" || r.status === "처리중");

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">발주 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">발주 내역 조회 및 신규 발주 등록</p>
      </div>
      <RequestsClient
        initialRequests={pending}
        initialOrders={orders}
        initialInbound={[]}
        initialOutbound={[]}
        sites={sites}
        vendors={vendors}
        mode="orders-only"
      />
    </div>
  );
}
