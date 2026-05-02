"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { hashPassword } from "@/lib/password";

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const trimmed = name.trim();
    const { data: user, error: dbError } = await supabase
      .from("users")
      .select("id, name, dept, permissions, status")
      .eq("name", trimmed)
      .eq("status", "재직")
      .single();

    if (dbError || !user) {
      setError("이름을 확인해 주세요.");
      setSubmitting(false);
      return;
    }

    // password_hash 컬럼은 마이그레이션 후 활성화 — 컬럼 없으면 에러 무시
    const { data: pwRow } = await supabase
      .from("users")
      .select("password_hash")
      .eq("id", user.id)
      .single();

    const storedHash = (pwRow as { password_hash?: string | null } | null)?.password_hash ?? null;
    if (storedHash) {
      const inputHash = await hashPassword(password);
      if (inputHash !== storedHash) {
        setError("비밀번호가 올바르지 않습니다.");
        setSubmitting(false);
        return;
      }
    }

    login({
      id: user.id,
      name: user.name,
      dept: user.dept ?? "",
      permissions: (user.permissions ?? []) as import("@/lib/mock-users").Permission[],
    });
    router.replace("/dashboard");
  }

  if (isLoading || isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-700 mb-4">
            <span className="text-2xl">📦</span>
          </div>
          <h1 className="text-xl font-bold text-white">DS 자재관리 시스템</h1>
          <p className="text-slate-400 text-sm mt-1">승강기 유지보수 스마트 자재관리</p>
        </div>

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
            {submitting ? "확인 중..." : "로그인"}
          </button>

          <p className="text-center text-xs text-gray-400">초기 비밀번호: <span className="font-mono font-medium text-gray-500">1234</span></p>
        </form>
      </div>
    </div>
  );
}
