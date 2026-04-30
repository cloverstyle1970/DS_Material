import PeriodStatsClient from "@/components/stats/PeriodStatsClient";

export default function StatsPeriodPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-800">기간별 입출고 내역</h1>
        <p className="text-sm text-gray-500 mt-0.5">월별/분기별/연도별 입고·출고 추이 분석</p>
      </div>
      <PeriodStatsClient />
    </div>
  );
}
