"use client";

import { useSearchParams } from "next/navigation";
import OutboundEntry from "@/components/purchase/OutboundEntry";

export default function EditOutboundPage() {
  const sp = useSearchParams();
  const idStr = sp.get("id");
  const id = idStr ? Number(idStr) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return <div className="p-6 text-sm text-red-500">잘못된 출고 ID 입니다.</div>;
  }
  return <OutboundEntry editId={id} />;
}
