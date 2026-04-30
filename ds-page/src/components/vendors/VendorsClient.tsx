"use client";

import { useState, FormEvent } from "react";
import { VendorRecord, VendorType } from "@/lib/mock-vendors";
import { useAuth, isViewOnly } from "@/context/AuthContext";

// ── 공통 필드 입력 스타일 ───────────────────────────────────
const field = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400";

const TYPE_CLS: Record<VendorType, string> = {
  매입: "bg-blue-50 text-blue-600",
  매출: "bg-green-50 text-green-600",
  공통: "bg-purple-50 text-purple-600",
};

// ── 상세/수정 폼 ────────────────────────────────────────────
interface FormState {
  name: string;
  type: VendorType;
  bizNo: string;
  representative: string;
  bizType: string;
  bizItem: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  invoiceManager: string;
  invoiceEmail: string;
}

function emptyForm(): FormState {
  return { name: "", type: "매입", bizNo: "", representative: "", bizType: "", bizItem: "", postalCode: "", address: "", phone: "", fax: "", invoiceManager: "", invoiceEmail: "" };
}

function vendorToForm(v: VendorRecord): FormState {
  return {
    name: v.name,
    type: v.type ?? "매입",
    bizNo: v.bizNo ?? "",
    representative: v.representative ?? "",
    bizType: v.bizType ?? "",
    bizItem: v.bizItem ?? "",
    postalCode: v.postalCode ?? "",
    address: v.address ?? "",
    phone: v.phone ?? "",
    fax: v.fax ?? "",
    invoiceManager: v.invoiceManager ?? "",
    invoiceEmail: v.invoiceEmail ?? "",
  };
}

// ── 등록/수정 모달 ──────────────────────────────────────────
interface ModalProps {
  title: string;
  initial: FormState;
  saving: boolean;
  error: string;
  onSubmit: (f: FormState) => void;
  onClose: () => void;
  submitLabel: string;
  submitCls: string;
}

function VendorFormModal({ title, initial, saving, error, onSubmit, onClose, submitLabel, submitCls }: ModalProps) {
  const [f, setF] = useState<FormState>(initial);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSubmit(f); }} className="px-6 py-5 space-y-3 overflow-y-auto flex-1">
          {/* 거래처명 + 구분 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">거래처명 <span className="text-red-500">*</span></label>
              <input value={f.name} onChange={set("name")} required className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">구분 <span className="text-red-500">*</span></label>
              <select value={f.type} onChange={set("type")} className={field}>
                <option value="매입">매입</option>
                <option value="매출">매출</option>
                <option value="공통">공통</option>
              </select>
            </div>
          </div>

          {/* 사업자번호 + 대표자 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">사업자번호</label>
              <input value={f.bizNo} onChange={set("bizNo")} placeholder="000-00-00000" className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">대표자명</label>
              <input value={f.representative} onChange={set("representative")} className={field} />
            </div>
          </div>

          {/* 업태 + 종목 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">업태</label>
              <input value={f.bizType} onChange={set("bizType")} className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">종목</label>
              <input value={f.bizItem} onChange={set("bizItem")} className={field} />
            </div>
          </div>

          {/* 전화 + 팩스 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">전화번호</label>
              <input value={f.phone} onChange={set("phone")} placeholder="031-000-0000" className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">팩스번호</label>
              <input value={f.fax} onChange={set("fax")} className={field} />
            </div>
          </div>

          {/* 주소 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">주소 (도로명)</label>
            <div className="flex gap-2">
              <input value={f.address} onChange={set("address")} placeholder="도로명주소 검색 또는 직접 입력" className={`${field} flex-1`} />
              <button
                type="button"
                onClick={() => {
                  if (typeof window === "undefined") return;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const daum = (window as any).daum;
                  if (!daum?.Postcode) { alert("주소 검색 서비스를 불러오는 중입니다. 잠시 후 다시 시도해 주세요."); return; }
                  new daum.Postcode({
                    oncomplete(data: { roadAddress: string; jibunAddress: string; zonecode: string }) {
                      setF(p => ({
                        ...p,
                        postalCode: data.zonecode,
                        address: data.roadAddress || data.jibunAddress,
                      }));
                    },
                  }).open();
                }}
                className="shrink-0 px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 hover:border-slate-300 transition-colors whitespace-nowrap"
              >
                🔍 주소 검색
              </button>
            </div>
            {f.postalCode && (
              <p className="mt-1 text-xs text-gray-400">우편번호: {f.postalCode}</p>
            )}
          </div>

          {/* 계산서 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">계산서담당</label>
              <input value={f.invoiceManager} onChange={set("invoiceManager")} className={field} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">계산서메일</label>
              <input value={f.invoiceEmail} onChange={set("invoiceEmail")} type="email" className={field} />
            </div>
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">취소</button>
            <button type="submit" disabled={saving || !f.name.trim()}
              className={`flex-1 rounded-lg py-2.5 text-sm font-medium text-white disabled:opacity-50 transition-colors ${submitCls}`}>
              {saving ? "저장 중..." : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const PAGE_SIZE = 20;

// ── 메인 컴포넌트 ───────────────────────────────────────────
interface Props { initial: VendorRecord[] }

export default function VendorsClient({ initial }: Props) {
  const [vendors, setVendors] = useState(initial);
  const [query, setQuery]     = useState("");
  const [typeFilter, setTypeFilter] = useState<VendorType | "전체">("전체");
  const [page, setPage]       = useState(1);
  const [selected, setSelected]   = useState<VendorRecord | null>(null);
  const [showAdd, setShowAdd]     = useState(false);
  const [editTarget, setEditTarget] = useState<VendorRecord | null>(null);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<VendorRecord | null>(null);

  const { user } = useAuth();
  const admin = user ? !isViewOnly(user) : false;

  const q = query.trim().toLowerCase();
  const filtered = vendors.filter(v => {
    if (typeFilter !== "전체") {
      const match = v.type === typeFilter || (v.type === "공통" && (typeFilter === "매입" || typeFilter === "매출"));
      if (!match) return false;
    }
    if (!q) return true;
    return (
      v.name.toLowerCase().includes(q) ||
      (v.representative?.toLowerCase().includes(q) ?? false) ||
      (v.address?.toLowerCase().includes(q) ?? false) ||
      (v.phone?.toLowerCase().includes(q) ?? false) ||
      (v.bizNo?.toLowerCase().includes(q) ?? false)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function changePage(next: number) { setPage(Math.max(1, Math.min(next, totalPages))); }
  function resetPage() { setPage(1); }

  async function reload() {
    const res = await fetch("/api/vendors");
    setVendors(await res.json());
  }

  async function handleAdd(f: FormState) {
    setSaving(true); setError("");
    const res = await fetch("/api/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, bizNo: f.bizNo || null, vendorCode: null }),
    });
    setSaving(false);
    if (!res.ok) { setError("등록 중 오류가 발생했습니다."); return; }
    await reload();
    setShowAdd(false);
  }

  async function handleEdit(f: FormState) {
    if (!editTarget) return;
    setSaving(true); setError("");
    const res = await fetch(`/api/vendors/${editTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    setSaving(false);
    if (!res.ok) { setError("수정 중 오류가 발생했습니다."); return; }
    await reload();
    setEditTarget(null);
    setSelected(null);
  }

  async function handleDelete(v: VendorRecord) {
    const res = await fetch(`/api/vendors/${v.id}`, { method: "DELETE" });
    if (!res.ok) { alert("삭제 중 오류가 발생했습니다."); return; }
    await reload();
    setDeleteConfirm(null);
    setSelected(null);
  }

  return (
    <>
      {/* 툴바 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 구분 필터 */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl shrink-0">
          {(["전체", "매입", "매출", "공통"] as const).map(t => {
            const count = t === "전체" ? vendors.length
              : t === "매입" ? vendors.filter(v => v.type === "매입" || v.type === "공통").length
              : t === "매출" ? vendors.filter(v => v.type === "매출" || v.type === "공통").length
              : vendors.filter(v => v.type === "공통").length;
            return (
              <button key={t} type="button" onClick={() => { setTypeFilter(t); resetPage(); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                  ${typeFilter === t ? "bg-white text-gray-700 shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>
                {t} <span className="font-normal opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {/* 검색 */}
        <div className="relative flex-1 min-w-48">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input value={query} onChange={e => { setQuery(e.target.value); resetPage(); }}
            placeholder="거래처명, 대표자, 사업자번호, 전화번호 검색"
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white" />
          {query && (
            <button type="button" onClick={() => { setQuery(""); resetPage(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          )}
        </div>

        <span className="text-sm text-gray-500 shrink-0">
          {q
            ? `검색 ${filtered.length.toLocaleString()}건`
            : typeFilter !== "전체"
              ? `${typeFilter} ${filtered.length.toLocaleString()}건`
              : `전체 ${vendors.length.toLocaleString()}건`}
        </span>

        {admin && (
          <button type="button" onClick={() => { setShowAdd(true); setError(""); }}
            className="bg-slate-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shrink-0">
            + 거래처 등록
          </button>
        )}
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {["구분", "거래처명", "대표자", "사업자번호", "전화번호", "주소", ...(admin ? [""] : [])].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
              <tr><td colSpan={admin ? 7 : 6} className="text-center py-12 text-gray-400">
                {q ? "검색 결과가 없습니다" : "등록된 거래처가 없습니다"}
              </td></tr>
            ) : paginated.map(v => (
              <tr key={v.id} onClick={() => setSelected(v)}
                className="hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_CLS[v.type ?? "매출"]}`}>
                    {v.type ?? "매출"}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-800 max-w-[200px] truncate whitespace-nowrap">{v.name}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.representative ?? "-"}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">{v.bizNo ?? "-"}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{v.phone ?? "-"}</td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-[200px] truncate">{v.address ?? "-"}</td>
                {admin && (
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => { setEditTarget(v); setError(""); }}
                        className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-slate-50 hover:text-slate-700 transition-colors">수정</button>
                      <button type="button" onClick={() => setDeleteConfirm(v)}
                        className="text-xs px-2.5 py-1 rounded-lg border border-red-100 text-red-400 hover:bg-red-50 transition-colors">삭제</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/60">
            <span className="text-xs text-gray-500">
              {((safePage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString()} / {filtered.length.toLocaleString()}건
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => changePage(1)} disabled={safePage === 1}
                className="px-2 py-1.5 rounded text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">«</button>
              <button onClick={() => changePage(safePage - 1)} disabled={safePage === 1}
                className="px-3 py-1.5 rounded text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹ 이전</button>
              {(() => {
                const half = 2;
                let start = Math.max(1, safePage - half);
                let end   = Math.min(totalPages, start + 4);
                if (end - start < 4) start = Math.max(1, end - 4);
                return Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => (
                  <button key={p} onClick={() => changePage(p)}
                    className={`min-w-[32px] px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                      p === safePage ? "bg-slate-700 text-white" : "text-gray-600 hover:bg-gray-200"
                    }`}>{p}</button>
                ));
              })()}
              <button onClick={() => changePage(safePage + 1)} disabled={safePage === totalPages}
                className="px-3 py-1.5 rounded text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">다음 ›</button>
              <button onClick={() => changePage(totalPages)} disabled={safePage === totalPages}
                className="px-2 py-1.5 rounded text-xs text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">»</button>
            </div>
            <span className="text-xs text-gray-400">{safePage} / {totalPages} 페이지</span>
          </div>
        )}
      </div>

      {/* 상세 보기 */}
      {selected && !editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-800">{selected.name}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_CLS[selected.type ?? "매출"]}`}>{selected.type}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">코드 {selected.vendorCode ?? "-"}</p>
              </div>
              <div className="flex items-center gap-2">
                {admin && (
                  <>
                    <button type="button" onClick={() => { setEditTarget(selected); setError(""); }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors font-medium">수정</button>
                    <button type="button" onClick={() => setDeleteConfirm(selected)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors font-medium">삭제</button>
                  </>
                )}
                <button type="button" onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-1">×</button>
              </div>
            </div>
            <div className="px-6 py-5 space-y-2.5 overflow-y-auto">
              {[
                ["사업자번호", selected.bizNo],
                ["대표자명",   selected.representative],
                ["업태",       selected.bizType],
                ["종목",       selected.bizItem],
                ["우편번호",   selected.postalCode],
                ["주소",       selected.address],
                ["전화번호",   selected.phone],
                ["팩스번호",   selected.fax],
                ["계산서담당", selected.invoiceManager],
                ["계산서메일", selected.invoiceEmail],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <span className="text-gray-400 w-24 shrink-0 text-sm">{label}</span>
                  <span className="text-gray-800 text-sm break-all">{value || "-"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 등록 모달 */}
      {showAdd && (
        <VendorFormModal
          title="거래처 등록"
          initial={emptyForm()}
          saving={saving}
          error={error}
          onSubmit={handleAdd}
          onClose={() => setShowAdd(false)}
          submitLabel="등록"
          submitCls="bg-slate-700 hover:bg-slate-800"
        />
      )}

      {/* 수정 모달 */}
      {editTarget && (
        <VendorFormModal
          title="거래처 수정"
          initial={vendorToForm(editTarget)}
          saving={saving}
          error={error}
          onSubmit={handleEdit}
          onClose={() => setEditTarget(null)}
          submitLabel="수정 저장"
          submitCls="bg-slate-700 hover:bg-slate-800"
        />
      )}

      {/* 삭제 확인 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-800 mb-2">거래처 삭제</h3>
            <p className="text-sm text-gray-600 mb-1">
              <span className="font-medium text-gray-800">{deleteConfirm.name}</span>을(를) 삭제하시겠습니까?
            </p>
            <p className="text-xs text-red-500 mb-5">삭제 후 복구할 수 없습니다.</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">취소</button>
              <button type="button" onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors">삭제</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
