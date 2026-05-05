import SerialHistoryClient from "@/components/serial-history/SerialHistoryClient";

export default function SerialHistoryPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">S/N 이력 추적</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">S/N 단위 자재 인스턴스의 입고·출고·회수·반납 타임라인 조회</p>
      </div>
      <SerialHistoryClient />
    </div>
  );
}
