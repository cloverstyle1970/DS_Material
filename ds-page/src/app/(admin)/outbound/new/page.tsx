import { getSites } from "@/lib/mock-sites";
import OutboundEntry from "@/components/purchase/OutboundEntry";

export default function NewOutboundPage() {
  const sites = getSites().map(s => ({ id: s.id, name: s.name }));
  return <OutboundEntry sites={sites} />;
}
