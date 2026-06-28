"use client";

import { useAuth, hasMenuPermission } from "@/context/AuthContext";
import HazardMasterPanel from "@/components/safety/HazardMaster";

const HREF = "/safety/hazard-master";

export default function HazardMasterClient() {
  const { user } = useAuth();

  if (!user) return <div className="p-8 text-center text-sm text-gray-500">로그인이 필요합니다.</div>;
  if (!hasMenuPermission(user, HREF, "read")) {
    return (
      <div className="p-12 text-center">
        <div className="text-5xl mb-3">🔒</div>
        <div className="text-base font-semibold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</div>
      </div>
    );
  }
  const canWrite = hasMenuPermission(user, HREF, "create") || hasMenuPermission(user, HREF, "update");

  return (
    <div className="min-h-full bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4">
        <h1 className="text-base font-bold text-gray-900 dark:text-white">유해요인조사 마스터</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          대분류(문서번호)와 유해요인조사표 전체 항목·기본 유/무를 관리합니다. 유해요인조사표·위험성평가의 공통 원본입니다.
        </p>
      </div>

      <div className="px-4 sm:px-6 py-4">
        <HazardMasterPanel canWrite={canWrite} />
      </div>
    </div>
  );
}
