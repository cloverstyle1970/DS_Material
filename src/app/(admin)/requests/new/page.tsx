import { getSites } from "@/lib/mock-sites";
import MaterialRequestEntry from "@/components/purchase/MaterialRequestEntry";

export default function NewMaterialRequestPage() {
  const sites = getSites().map(s => ({ id: s.id, name: s.name }));
  return <MaterialRequestEntry sites={sites} />;
}
