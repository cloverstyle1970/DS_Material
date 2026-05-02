import Header from "@/components/layout/Header";
import InventoryCheckClient from "@/components/materials/InventoryCheckClient";

export default function InventoryCheckPage() {
  return (
    <>
      <Header title="재고실사" />
      <main className="flex-1 p-6 space-y-4">
        <InventoryCheckClient />
      </main>
    </>
  );
}
