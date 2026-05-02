import SiteStatsClient from "@/components/stats/SiteStatsClient";

export default function StatsSitesPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">현장/호기별 투입 현황</h1>
        <p className="text-sm text-gray-500 mt-0.5">현장별·자재별 입출고 집계 및 분석</p>
      </div>
      <SiteStatsClient />
    </div>
  );
}
