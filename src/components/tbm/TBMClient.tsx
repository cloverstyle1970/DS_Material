"use client";

import { useState } from "react";
import { useAuth, isAdmin } from "@/context/AuthContext";
import TBMWriteForm from "./TBMWriteForm";
import TBMMyList from "./TBMMyList";

type SubTab = "write" | "my";

export default function TBMClient() {
  const { user } = useAuth();
  const [tab, setTab] = useState<SubTab>("write");

  if (!user) {
    return (
      <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
        로그인이 필요합니다.
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-gray-900 dark:text-white">TBM 작성</h1>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {user.name} · {user.dept} {isAdmin(user) && "· 관리자"}
            </p>
          </div>
        </div>
      </div>

      {/* 서브 탭 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sticky top-[57px] z-10">
        <div className="max-w-2xl mx-auto flex gap-1">
          <SubTabButton active={tab === "write"} onClick={() => setTab("write")}>
            ✍️ 작성
          </SubTabButton>
          <SubTabButton active={tab === "my"} onClick={() => setTab("my")}>
            📋 내 TBM
          </SubTabButton>
        </div>
      </div>

      {/* 본문 */}
      <div className="max-w-2xl mx-auto p-4 pb-12">
        {tab === "write" && <TBMWriteForm onSaved={() => setTab("my")} />}
        {tab === "my" && <TBMMyList />}
      </div>
    </div>
  );
}

function SubTabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? "text-blue-600 dark:text-blue-400 border-blue-500"
          : "text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
