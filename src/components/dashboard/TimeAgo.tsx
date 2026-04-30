"use client";

import { useEffect, useState } from "react";

function format(diffSec: number): string {
  if (diffSec < 60) return `${diffSec}초 전`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  return `${Math.floor(diffSec / 86400)}일 전`;
}

export default function TimeAgo({ iso }: { iso: string }) {
  // 서버/클라이언트 첫 렌더에서는 동일한 빈 값 → 하이드레이션 안전
  const [label, setLabel] = useState<string>("");

  useEffect(() => {
    const ts = new Date(iso).getTime();
    const tick = () => setLabel(format(Math.floor((Date.now() - ts) / 1000)));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [iso]);

  return <>{label}</>;
}
