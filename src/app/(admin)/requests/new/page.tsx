import { Suspense } from "react";
import MaterialRequestEntry from "@/components/purchase/MaterialRequestEntry";

export default function NewMaterialRequestPage() {
  return (
    <Suspense>
      <MaterialRequestEntry />
    </Suspense>
  );
}
