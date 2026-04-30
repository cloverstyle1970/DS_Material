interface StatCardProps {
  label: string;
  value: number;
  unit?: string;
  color: "blue" | "orange" | "red" | "green";
}

const COLOR_MAP = {
  blue:   "bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300",
  orange: "bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-700 text-orange-700 dark:text-orange-300",
  red:    "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300",
  green:  "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700 text-green-700 dark:text-green-300",
};

const NUM_COLOR_MAP = {
  blue:   "text-blue-600",
  orange: "text-orange-600",
  red:    "text-red-600",
  green:  "text-green-600",
};

export default function StatCard({ label, value, unit = "건", color }: StatCardProps) {
  return (
    <div className={`rounded-xl border p-5 ${COLOR_MAP[color]}`}>
      <p className="text-sm font-medium mb-2">{label}</p>
      <p className={`text-3xl font-bold ${NUM_COLOR_MAP[color]}`}>
        {value.toLocaleString()}
        <span className="text-base font-normal ml-1">{unit}</span>
      </p>
    </div>
  );
}
