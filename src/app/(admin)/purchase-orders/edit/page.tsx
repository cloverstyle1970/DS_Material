"use client";

import { useSearchParams } from "next/navigation";
import PurchaseOrderEntry from "@/components/purchase/PurchaseOrderEntry";

export default function EditPurchaseOrderPage() {
  const sp = useSearchParams();
  const idStr = sp.get("id");
  const id = idStr ? Number(idStr) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return (
      <div className="p-6 text-sm text-red-500">잘못된 발주 ID 입니다.</div>
    );
  }
  return <PurchaseOrderEntry editId={id} />;
}
