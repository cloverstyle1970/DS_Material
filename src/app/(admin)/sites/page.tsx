import { getSites } from "@/lib/mock-sites";
import { getAllElevators } from "@/lib/mock-elevators";
import SitesClient from "@/components/sites/SitesClient";

export default function SitesPage() {
  const sites     = getSites();
  const elevators = getAllElevators();
  return <SitesClient initial={sites} elevators={elevators} />;
}
