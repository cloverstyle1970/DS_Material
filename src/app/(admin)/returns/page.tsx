import ReturnsClient from "@/components/returns/ReturnsClient";

export default function ReturnsPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">회수/반납 관리</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">출고 시 회수 표시된 자재의 반납 등록</p>
      </div>
      <ReturnsClient />
    </div>
  );
}
