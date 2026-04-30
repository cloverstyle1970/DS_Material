import { getVendors } from "@/lib/mock-vendors";
import VendorsClient from "@/components/vendors/VendorsClient";

export default function VendorsPage() {
  const vendors = getVendors();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">거래처 관리</h1>
        <p className="text-sm text-gray-500 mt-0.5">협력 거래처 목록 조회 및 정보 관리</p>
      </div>
      <VendorsClient initial={vendors} />
    </div>
  );
}
