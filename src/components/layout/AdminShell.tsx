"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Sidebar from "./Sidebar";
import SidebarContext from "@/context/SidebarContext";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  // 데스크탑(md 이상)에서는 사이드바 기본 열림, 모바일에서는 닫힘
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (window.innerWidth >= 768) {
      setSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  const showShell = !isLoading && isAuthenticated;

  return (
    <SidebarContext.Provider value={{ openSidebar: () => setSidebarOpen(true) }}>
      <div className="flex h-full bg-gray-50 dark:bg-gray-900">
        {showShell && (
          <Sidebar
            open={sidebarOpen}
            onToggle={() => setSidebarOpen(o => !o)}
            onClose={() => setSidebarOpen(false)}
          />
        )}
        <div className="flex-1 flex flex-col min-h-0 overflow-auto">
          {showShell ? children : null}
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
