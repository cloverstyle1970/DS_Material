import { getSites } from "@/lib/mock-sites";
import { getVendors } from "@/lib/mock-vendors";
import { getMaterialRequests } from "@/lib/mock-material-requests";
import PurchaseOrderEntry from "@/components/purchase/PurchaseOrderEntry";

export default function NewPurchaseOrderPage() {
  const sites   = getSites().map(s => ({ id: s.id, name: s.name }));
  const vendors = getVendors().map(v => ({ id: v.id, name: v.name }));
  const pendingRequests = getMaterialRequests().filter(r => r.status === "신청" || r.status === "처리중");

  return <PurchaseOrderEntry sites={sites} vendors={vendors} pendingRequests={pendingRequests} />;
}
