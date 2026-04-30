"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import usersJson from "@/data/users.json";

const MOCK_PASSWORD = "1234";

const ACTIVE_USERS = (usersJson as { id: number; name: string; dept: string; status: string; permissions: string[] }[])
  .filter(u => u.status === "재직");

export default function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isLoading, isAuthenticated, router]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const trimmed = name.trim();
    const matched = ACTIVE_USERS.find(u => u.name === trimmed);

    if (!matched) {
      setError("이름을 확인해 주세요.");
      setSubmitting(false);
      return;
    }
    if (password !== MOCK_PASSWORD) {
      setError("비밀번호가 올바르지 않습니다.");
      setSubmitting(false);
      return;
    }

    login({ id: matched.id, name: matched.name, dept: matched.dept, permissions: (matched.permissions ?? []) as import("@/lib/mock-users").Permission[] });
    router.replace("/dashboard");
  }

  if (isLoading || isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* 로고 영역 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-700 mb-4">
            <span className="text-2xl">📦</span>
          </div>
          <h1 className="text-xl font-bold text-white">DS 자재관리 시스템</h1>
          <p className="text-slate-400 text-sm mt-1">승강기 유지보수 스마트 자재관리</p>
        </div>

        {/* 로그인 카드 */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-8 space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">이름</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="홍길동"
              autoComplete="username"
              autoFocus
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-gray-50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••"
              autoComplete="current-password"
              required
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-gray-50"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-slate-800 text-white py-3 rounded-xl text-sm font-semibold hover:bg-slate-700 transition-colors disabled:opacity-60"
          >
            로그인
          </button>

          <p className="text-center text-xs text-gray-400">초기 비밀번호: <span className="font-mono font-medium text-gray-500">1234</span></p>
        </form>
      </div>
    </div>
  );
}
