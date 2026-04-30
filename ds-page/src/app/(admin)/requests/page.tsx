import { getMaterialRequests } from "@/lib/mock-material-requests";
import { getPurchaseOrders } from "@/lib/mock-purchase-orders";
import { getTransactions } from "@/lib/mock-transactions";
import { getSites } from "@/lib/mock-sites";
import { getVendors } from "@/lib/mock-vendors";
import { getMaterials } from "@/lib/mock-materials";
import RequestsClient from "@/components/requests/RequestsClient";

export default function RequestsPage() {
  const requests = getMaterialRequests();
  const orders   = getPurchaseOrders();
  const inbound  = getTransactions("입고");
  const outbound = getTransactions("출고");
  const sites    = getSites().map(s => ({ id: s.id, name: s.name }));
  const vendors  = getVendors(undefined, "매입").map(v => ({ id: v.id, name: v.name }));

  // 자재코드 → 별칭 맵 (별칭 검색용)
  const materialAliases = getMaterials().reduce<Record<string, string>>((acc, m) => {
    if (m.alias) acc[m.id] = m.alias;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">자재 신청 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">현장 자재 신청 내역 조회 및 처리</p>
      </div>
      <RequestsClient
        initialRequests={requests}
        initialOrders={orders}
        initialInbound={inbound}
        initialOutbound={outbound}
        sites={sites}
        vendors={vendors}
        mode="requests-only"
        materialAliases={materialAliases}
      />
    </div>
  );
}
