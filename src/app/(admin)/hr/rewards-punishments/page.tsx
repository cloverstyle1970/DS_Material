import RewardsPunishmentsClient from "@/components/hr/RewardsPunishmentsClient";

export default function RewardsPunishmentsPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">상벌사항 관리</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">사원 상벌 이력 등록·수정·삭제</p>
      </div>
      <RewardsPunishmentsClient />
    </div>
  );
}
