"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { api, getErrorMessage } from "@/lib/api-client";
import { useAuth, isAdmin } from "@/context/AuthContext";

export interface ConstructionRequest {
  id: number;
  status: "요청" | "접수" | "일정등록됨" | "완료";
  siteName: string;
  elevatorName: string;
  requesterName: string;
  details: string;
  requestedAt: string;
}

interface SiteOption { id: number; name: string }

export default function ConstructionRequestClient() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ConstructionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Modal State
  const [siteName, setSiteName] = useState("");
  const [elevatorName, setElevatorName] = useState("");
  const [details, setDetails] = useState("");
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchRequests();
    api.get<SiteOption[]>("/api/sites").then(setSites).catch(() => {});
  }, []);

  async function fetchRequests() {
    setLoading(true);
    try {
      const data = await api.get<ConstructionRequest[]>("/api/construction-requests");
      setRequests(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!siteName || !details) return alert("현장명과 공사내역을 입력해주세요.");
    setSaving(true);
    try {
      await api.post("/api/construction-requests", {
        siteName,
        elevatorName,
        details,
        requesterName: user?.name || "익명",
      });
      setShowModal(false);
      setSiteName("");
      setElevatorName("");
      setDetails("");
      fetchRequests();
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // 권한 체크
  const canSchedule = user && (isAdmin(user) || user.name === "송영권" || user.name === "이종선");

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <span className="text-orange-500">📝</span> 공사 요청
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">현장 공사 일정을 요청합니다.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-orange-600 text-white text-sm font-semibold rounded-lg shadow hover:bg-orange-700 transition-colors"
        >
          + 공사 요청 등록
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex justify-center py-10"><span className="loader"></span></div>
        ) : requests.length === 0 ? (
          <div className="text-center py-20 text-gray-500 dark:text-gray-400">등록된 공사 요청이 없습니다.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {requests.map(req => (
              <div key={req.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow bg-gray-50 dark:bg-gray-800/50">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${
                    req.status === "요청" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                    req.status === "일정등록됨" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                    "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                  }`}>
                    {req.status}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{new Date(req.requestedAt).toLocaleDateString()}</span>
                </div>
                <h3 className="font-bold text-gray-800 dark:text-gray-100 mb-1">{req.siteName} {req.elevatorName && <span className="text-gray-500 text-sm font-normal">({req.elevatorName})</span>}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3 mb-3">{req.details}</p>
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
                  <span>신청자: {req.requesterName}</span>
                  {canSchedule && req.status === "요청" && (
                    <Link 
                      href={`/construction/schedule?reqId=${req.id}&site=${encodeURIComponent(req.siteName)}&elevator=${encodeURIComponent(req.elevatorName)}&details=${encodeURIComponent(req.details)}`}
                      className="text-orange-600 dark:text-orange-400 font-medium hover:underline"
                    >
                      일정으로 등록 →
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">공사 요청 등록</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">현장명 <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  value={siteName} 
                  onChange={e => setSiteName(e.target.value)} 
                  placeholder="현장명을 입력하거나 검색하세요" 
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  list="sites-list"
                />
                <datalist id="sites-list">
                  {sites.map(s => <option key={s.id} value={s.name} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">호기 정보</label>
                <input 
                  type="text" 
                  value={elevatorName} 
                  onChange={e => setElevatorName(e.target.value)} 
                  placeholder="예: 1호기, 2호기 (생략 가능)" 
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">공사 내역 <span className="text-red-500">*</span></label>
                <textarea 
                  value={details} 
                  onChange={e => setDetails(e.target.value)} 
                  placeholder="요청하시는 공사 내용을 상세히 입력해주세요." 
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
                />
              </div>
              <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600">취소</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded hover:bg-orange-700 disabled:opacity-50">등록하기</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
