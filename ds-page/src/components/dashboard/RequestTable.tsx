import { RecentRequest, RequestStatus } from "@/lib/types";

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending:    "대기",
  dispatched: "출고",
  completed:  "완료",
};

const STATUS_CLASS: Record<RequestStatus, string> = {
  pending:    "bg-yellow-100 text-yellow-700",
  dispatched: "bg-blue-100 text-blue-700",
  completed:  "bg-green-100 text-green-700",
};

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

export default function RequestTable({ requests }: { requests: RecentRequest[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700">최근 자재 신청</h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {["자재명", "현장", "호기", "신청자", "수량", "상태", "시각"].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {requests.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 font-medium text-gray-800">{r.materialName}</td>
              <td className="px-4 py-3 text-gray-600">{r.siteName}</td>
              <td className="px-4 py-3 text-gray-600">{r.hoGiNo}</td>
              <td className="px-4 py-3 text-gray-600">{r.userName}</td>
              <td className="px-4 py-3 text-gray-600">{r.qty}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-400 text-xs">{timeAgo(r.requestedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
