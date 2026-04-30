"use client";

import { useTheme } from "@/context/ThemeContext";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className={`min-h-full transition-colors ${isDark ? "bg-gray-900" : "bg-gray-50"}`}>
      {/* 헤더 */}
      <div className={`px-6 py-4 border-b ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
        <h1 className={`text-base font-semibold ${isDark ? "text-white" : "text-gray-800"}`}>환경설정</h1>
        <p className={`text-xs mt-0.5 ${isDark ? "text-gray-400" : "text-gray-500"}`}>시스템 화면 환경을 설정합니다</p>
      </div>

      <div className="p-6 max-w-xl space-y-5">
        {/* 테마 카드 */}
        <div className={`rounded-xl border p-5 transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
          <h2 className={`text-sm font-semibold mb-1 ${isDark ? "text-gray-200" : "text-gray-700"}`}>화면 테마</h2>
          <p className={`text-xs mb-4 ${isDark ? "text-gray-500" : "text-gray-400"}`}>선택한 테마가 모든 페이지에 적용됩니다</p>

          <div className="grid grid-cols-2 gap-3">
            {/* 라이트 모드 */}
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`relative rounded-xl border-2 p-4 text-left transition-all ${
                theme === "light"
                  ? "border-blue-500 " + (isDark ? "bg-blue-900/20" : "bg-blue-50")
                  : isDark ? "border-gray-700 hover:border-gray-500" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              {/* 미리보기 */}
              <div className="rounded-lg bg-gray-50 border border-gray-200 h-24 mb-3 overflow-hidden">
                <div className="bg-white border-b border-gray-100 h-7 flex items-center px-2 gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-gray-300" />
                  <div className="flex-1 h-1.5 rounded bg-gray-100" />
                </div>
                <div className="flex h-[calc(100%-28px)]">
                  <div className="w-10 bg-slate-800 h-full" />
                  <div className="flex-1 p-2 space-y-1.5">
                    <div className="h-1.5 rounded bg-gray-200 w-3/4" />
                    <div className="h-1.5 rounded bg-gray-100 w-1/2" />
                    <div className="h-1.5 rounded bg-gray-200 w-2/3" />
                    <div className="h-1.5 rounded bg-gray-100 w-3/5" />
                  </div>
                </div>
              </div>
              <p className={`text-sm font-semibold ${theme === "light" ? "text-blue-600" : isDark ? "text-gray-200" : "text-gray-700"}`}>
                라이트 모드
              </p>
              <p className={`text-xs mt-0.5 ${theme === "light" ? (isDark ? "text-blue-400" : "text-blue-500") : isDark ? "text-gray-500" : "text-gray-400"}`}>
                밝은 배경의 기본 화면
              </p>
              {theme === "light" && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                  ✓
                </div>
              )}
            </button>

            {/* 다크 모드 */}
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`relative rounded-xl border-2 p-4 text-left transition-all ${
                theme === "dark"
                  ? "border-blue-500 bg-blue-900/20"
                  : isDark ? "border-gray-700 hover:border-gray-500" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              {/* 미리보기 */}
              <div className="rounded-lg bg-gray-900 border border-gray-700 h-24 mb-3 overflow-hidden">
                <div className="bg-gray-800 border-b border-gray-700 h-7 flex items-center px-2 gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-gray-600" />
                  <div className="flex-1 h-1.5 rounded bg-gray-700" />
                </div>
                <div className="flex h-[calc(100%-28px)]">
                  <div className="w-10 bg-slate-900 h-full border-r border-gray-700" />
                  <div className="flex-1 p-2 space-y-1.5">
                    <div className="h-1.5 rounded bg-gray-600 w-3/4" />
                    <div className="h-1.5 rounded bg-gray-700 w-1/2" />
                    <div className="h-1.5 rounded bg-gray-600 w-2/3" />
                    <div className="h-1.5 rounded bg-gray-700 w-3/5" />
                  </div>
                </div>
              </div>
              <p className={`text-sm font-semibold ${theme === "dark" ? "text-blue-400" : isDark ? "text-gray-200" : "text-gray-700"}`}>
                다크 모드
              </p>
              <p className={`text-xs mt-0.5 ${theme === "dark" ? "text-blue-500" : isDark ? "text-gray-500" : "text-gray-400"}`}>
                어두운 배경의 화면
              </p>
              {theme === "dark" && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                  ✓
                </div>
              )}
            </button>
          </div>
        </div>

        {/* 현재 적용 상태 */}
        <div className={`rounded-xl border px-5 py-4 flex items-center gap-3 transition-colors ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0 ${isDark ? "bg-gray-700" : "bg-gray-100"}`}>
            {isDark ? "🌙" : "☀️"}
          </div>
          <div>
            <p className={`text-sm font-medium ${isDark ? "text-gray-200" : "text-gray-700"}`}>
              현재 <span className={isDark ? "text-blue-400" : "text-blue-600"}>{isDark ? "다크 모드" : "라이트 모드"}</span> 적용 중
            </p>
            <p className={`text-xs mt-0.5 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
              설정은 브라우저에 저장되며 다음 접속 시에도 유지됩니다
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
