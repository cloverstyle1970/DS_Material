"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import type { Permission } from "@/lib/mock-users";

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

    const username = name.trim();

    // 신DB accounts 기반 인증: username + password(평문) 매칭.
    // password 컬럼은 클라이언트로 내려받지 않고 필터 조건으로만 사용한다.
    const { data: account, error: qErr } = await supabase
      .from("accounts")
      .select("id, username, name, permissions, dept, theme, status")
      .eq("username", username)
      .eq("password", password)
      .maybeSingle();

    if (qErr) {
      // 조회 자체 실패(예: Invalid API key=옛 번들 캐시, 네트워크) — 비번 문제와 구분해 노출
      console.error("[login] accounts 조회 실패:", qErr);
      setError(`로그인 처리 오류: ${qErr.message || qErr.code || "네트워크 오류"} — 캐시 새로고침(Ctrl+Shift+R) 후 재시도하세요.`);
      setSubmitting(false);
      return;
    }
    if (!account) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
      setSubmitting(false);
      return;
    }

    // accounts.permissions 가 단일 진리원. role 컬럼은 표시용일 뿐 권한에 영향 없음.
    const permissions = (Array.isArray(account.permissions) ? account.permissions : []) as Permission[];

    login({
      id: Number(account.id),
      name: account.username,                 // username = 실제 사용자 식별자(데이터 병합 기준)
      dept: account.dept ?? "",
      permissions,
      theme: account.theme === "dark" ? "dark" : account.theme === "light" ? "light" : undefined,
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
            <label className="text-sm font-medium text-gray-700">아이디</label>
            <input
              type="text"
              lang="ko"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="아이디 입력"
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

        </form>
      </div>
    </div>
  );
}
