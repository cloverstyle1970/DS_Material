import Header from "@/components/layout/Header";
import MaterialsClient from "@/components/materials/MaterialsClient";

export default function MaterialsPage() {
  return (
    <>
      <Header title="자재관리" />
      <main className="flex-1 p-6 space-y-4">
        <MaterialsClient initial={[]} />
      </main>
    </>
  );
}
