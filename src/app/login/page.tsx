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
      router.replace("/me");
    }
  }, [isLoading, isAuthenticated, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const username = name.trim();

    // 1) accounts.username → id 매핑.
    //    RLS 강화 후엔 anon으로 accounts 직접 SELECT 가 막히므로 SECURITY DEFINER RPC 우선.
    //    RPC 미적용 환경(=현재처럼 USING TRUE)에서는 fallback 으로 직접 SELECT 도 통과.
    let accountId: number | null = null;
    const { data: rpcId, error: rpcErr } = await supabase.rpc(
      "lookup_account_id_by_username",
      { p_username: username }
    );
    if (!rpcErr && rpcId != null) {
      accountId = Number(rpcId);
    } else {
      const { data: row, error: selErr } = await supabase
        .from("accounts")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (selErr) {
        console.error("[login] accounts 조회 실패:", selErr);
        setError(`로그인 처리 오류: ${selErr.message || selErr.code || "네트워크 오류"} — 캐시 새로고침(Ctrl+Shift+R) 후 재시도하세요.`);
        setSubmitting(false);
        return;
      }
      if (row?.id != null) accountId = Number(row.id);
    }
    if (!accountId) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
      setSubmitting(false);
      return;
    }

    // 2) Supabase Auth 로그인 — JWT 세션이 sb-* localStorage 키에 자동 저장.
    const email = `${accountId}@daesol.el`;
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
      setSubmitting(false);
      return;
    }

    // 3) authenticated 상태에서 권한·부서·테마 fetch (RLS 강화 후에도 통과).
    const { data: account, error: qErr } = await supabase
      .from("accounts")
      .select("id, username, permissions, dept, theme, permission_group_id")
      .eq("id", accountId)
      .maybeSingle();
    if (qErr || !account) {
      console.error("[login] 인증 후 accounts 조회 실패:", qErr);
      await supabase.auth.signOut().catch(() => {});
      setError(`로그인 처리 오류: ${qErr?.message ?? "사용자 정보를 불러오지 못함"}`);
      setSubmitting(false);
      return;
    }

    const permissions = (Array.isArray(account.permissions) ? account.permissions : []) as Permission[];

    // 비관리자(보수일반/공사일반) 판정용 그룹명 로드
    let groupName: string | null = null;
    if (account.permission_group_id != null) {
      const { data: g } = await supabase
        .from("permission_groups")
        .select("name")
        .eq("id", account.permission_group_id)
        .maybeSingle();
      groupName = g?.name ?? null;
    }

    login({
      id: Number(account.id),
      name: account.username ?? username,
      dept: account.dept ?? "",
      permissions,
      theme: account.theme === "dark" ? "dark" : account.theme === "light" ? "light" : undefined,
      groupName,
    });
    router.replace("/me");
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
