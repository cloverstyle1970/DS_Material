import Header from "@/components/layout/Header";

export default function InventoryCheckPage() {
  return (
    <>
      <Header title="재고실사" />
      <main className="flex-1 p-6 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-4">📊</p>
          <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">재고실사</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">준비 중입니다</p>
        </div>
      </main>
    </>
  );
}
