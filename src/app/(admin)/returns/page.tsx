import ReturnsClient from "@/components/returns/ReturnsClient";

export default function ReturnsPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">회수/반납 관리</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">출고 시 회수 표시된 자재의 반납 등록</p>
      </div>
      <ReturnsClient />
    </div>
  );
}
