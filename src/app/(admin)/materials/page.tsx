import Header from "@/components/layout/Header";
import MaterialsClient from "@/components/materials/MaterialsClient";
import { getMaterials } from "@/lib/mock-materials";

export default function MaterialsPage() {
  const materials = getMaterials();

  return (
    <>
      <Header title="자재관리" />
      <main className="flex-1 p-6 space-y-4">
        <MaterialsClient initial={materials} />
      </main>
    </>
  );
}
