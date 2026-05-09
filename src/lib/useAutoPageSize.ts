"use client";

import { useEffect, useState } from "react";

const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_RESERVED   = 250;
const DEFAULT_MIN        = 5;
const SSR_FALLBACK       = 20;

export function useAutoPageSize(opts?: {
  rowHeight?: number;
  reserved?:  number;
  min?:       number;
}): number {
  const rowHeight = opts?.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const reserved  = opts?.reserved  ?? DEFAULT_RESERVED;
  const min       = opts?.min       ?? DEFAULT_MIN;

  const [pageSize, setPageSize] = useState<number>(SSR_FALLBACK);

  useEffect(() => {
    function compute() {
      const h = window.innerHeight - reserved;
      return Math.max(min, Math.floor(h / rowHeight));
    }
    setPageSize(compute());
    const onResize = () => setPageSize(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [rowHeight, reserved, min]);

  return pageSize;
}
