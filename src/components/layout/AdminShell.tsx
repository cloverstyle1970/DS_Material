"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Sidebar from "./Sidebar";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  // 인증 확인 중에는 빈 배경만 노출 — 콘텐츠 영역과 동일 색상으로 깜박임 최소화.
  // children은 항상 렌더링하여 SSR/네비게이션 간 레이아웃 깜박임을 방지.
  const showShell = !isLoading && isAuthenticated;

  return (
    <div className="flex h-full bg-gray-50 dark:bg-gray-900">
      {showShell && <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen(o => !o)} />}
      <div className="flex-1 flex flex-col min-h-0 overflow-auto">
        {showShell ? children : null}
      </div>
    </div>
  );
}
