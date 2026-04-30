export default function Header({ title }: { title: string }) {
  return (
    <header className="h-14 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between px-6 shrink-0">
      <h1 className="text-base font-semibold text-gray-800 dark:text-white">{title}</h1>
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500 dark:text-slate-400">관리자</span>
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-bold">
          관
        </div>
      </div>
    </header>
  );
}
