import VendorsClient from "@/components/vendors/VendorsClient";

export default function VendorsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">거래처 관리</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">협력 거래처 목록 조회 및 정보 관리</p>
      </div>
      <VendorsClient initial={[]} />
    </div>
  );
}
