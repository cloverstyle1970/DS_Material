import { getSites } from "@/lib/mock-sites";
import { getVendors } from "@/lib/mock-vendors";
import InboundEntry from "@/components/purchase/InboundEntry";

export default function NewInboundPage() {
  const sites   = getSites().map(s => ({ id: s.id, name: s.name }));
  const vendors = getVendors().map(v => ({ id: v.id, name: v.name }));
  return <InboundEntry sites={sites} vendors={vendors} />;
}
