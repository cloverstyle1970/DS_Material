import SiteStatsClient from "@/components/stats/SiteStatsClient";

export default function StatsSitesPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">현장/호기별 투입 현황</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">현장별·자재별 입출고 집계 및 분석</p>
      </div>
      <SiteStatsClient />
    </div>
  );
}
