export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

// 2024~2027 공휴일 (고정 + 음력 + 대체공휴일 전부 사전 계산)
const HOLIDAYS: Holiday[] = [
  // ── 2024 ──
  { date: "2024-01-01", name: "신정" },
  { date: "2024-02-09", name: "설날 연휴" },
  { date: "2024-02-10", name: "설날" },
  { date: "2024-02-11", name: "설날 연휴" },
  { date: "2024-02-12", name: "대체공휴일" },
  { date: "2024-03-01", name: "삼일절" },
  { date: "2024-05-05", name: "어린이날" },
  { date: "2024-05-06", name: "대체공휴일" },
  { date: "2024-05-15", name: "부처님오신날" },
  { date: "2024-06-06", name: "현충일" },
  { date: "2024-08-15", name: "광복절" },
  { date: "2024-09-16", name: "추석 연휴" },
  { date: "2024-09-17", name: "추석" },
  { date: "2024-09-18", name: "추석 연휴" },
  { date: "2024-10-03", name: "개천절" },
  { date: "2024-10-09", name: "한글날" },
  { date: "2024-12-25", name: "성탄절" },

  // ── 2025 ──
  { date: "2025-01-01", name: "신정" },
  { date: "2025-01-28", name: "설날 연휴" },
  { date: "2025-01-29", name: "설날" },
  { date: "2025-01-30", name: "설날 연휴" },
  { date: "2025-03-01", name: "삼일절" },
  { date: "2025-03-03", name: "대체공휴일" }, // 삼일절 토요일
  { date: "2025-05-05", name: "어린이날·부처님오신날" },
  { date: "2025-05-06", name: "대체공휴일" },
  { date: "2025-06-06", name: "현충일" },
  { date: "2025-08-15", name: "광복절" },
  { date: "2025-10-03", name: "개천절" },
  { date: "2025-10-05", name: "추석 연휴" },
  { date: "2025-10-06", name: "추석" },
  { date: "2025-10-07", name: "추석 연휴" },
  { date: "2025-10-08", name: "대체공휴일" }, // 추석 연휴 일요일
  { date: "2025-10-09", name: "한글날" },
  { date: "2025-12-25", name: "성탄절" },

  // ── 2026 ──
  { date: "2026-01-01", name: "신정" },
  { date: "2026-02-16", name: "설날 연휴" },
  { date: "2026-02-17", name: "설날" },
  { date: "2026-02-18", name: "설날 연휴" },
  { date: "2026-03-01", name: "삼일절" },
  { date: "2026-03-02", name: "대체공휴일" }, // 삼일절 일요일
  { date: "2026-05-05", name: "어린이날" },
  { date: "2026-05-24", name: "부처님오신날" },
  { date: "2026-05-25", name: "대체공휴일" }, // 부처님오신날 일요일
  { date: "2026-06-06", name: "현충일" },
  { date: "2026-06-08", name: "대체공휴일" }, // 현충일 토요일
  { date: "2026-08-15", name: "광복절" },
  { date: "2026-08-17", name: "대체공휴일" }, // 광복절 토요일
  { date: "2026-09-24", name: "추석 연휴" },
  { date: "2026-09-25", name: "추석" },
  { date: "2026-09-26", name: "추석 연휴" },
  { date: "2026-09-28", name: "대체공휴일" }, // 추석 연휴 토요일
  { date: "2026-10-03", name: "개천절" },
  { date: "2026-10-05", name: "대체공휴일" }, // 개천절 토요일
  { date: "2026-10-09", name: "한글날" },
  { date: "2026-12-25", name: "성탄절" },

  // ── 2027 ──
  { date: "2027-01-01", name: "신정" },
  { date: "2027-02-06", name: "설날 연휴" },
  { date: "2027-02-07", name: "설날" },
  { date: "2027-02-08", name: "설날 연휴" },
  { date: "2027-02-09", name: "대체공휴일" }, // 설날 일요일
  { date: "2027-03-01", name: "삼일절" },
  { date: "2027-05-05", name: "어린이날" },
  { date: "2027-05-13", name: "부처님오신날" },
  { date: "2027-06-06", name: "현충일" },
  { date: "2027-06-07", name: "대체공휴일" }, // 현충일 일요일
  { date: "2027-08-15", name: "광복절" },
  { date: "2027-08-16", name: "대체공휴일" }, // 광복절 일요일
  { date: "2027-09-14", name: "추석 연휴" },
  { date: "2027-09-15", name: "추석" },
  { date: "2027-09-16", name: "추석 연휴" },
  { date: "2027-10-03", name: "개천절" },
  { date: "2027-10-04", name: "대체공휴일" }, // 개천절 일요일
  { date: "2027-10-09", name: "한글날" },
  { date: "2027-10-11", name: "대체공휴일" }, // 한글날 토요일
  { date: "2027-12-25", name: "성탄절" },
  { date: "2027-12-27", name: "대체공휴일" }, // 성탄절 토요일
];

const _cache = new Map<number, Map<string, string>>();

export function getHolidaysForYear(year: number): Map<string, string> {
  if (_cache.has(year)) return _cache.get(year)!;
  const map = new Map<string, string>();
  for (const h of HOLIDAYS) {
    if (h.date.startsWith(`${year}-`)) map.set(h.date, h.name);
  }
  _cache.set(year, map);
  return map;
}
