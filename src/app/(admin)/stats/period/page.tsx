import PeriodStatsClient from "@/components/stats/PeriodStatsClient";

export default function StatsPeriodPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">기간별 입출고 내역</h1>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">월별/분기별/연도별 입고·출고 추이 분석</p>
      </div>
      <PeriodStatsClient />
    </div>
  );
}
