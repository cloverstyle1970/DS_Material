// 자격증 만료일 관련 공용 유틸. 사원관리·개인정보수정 등에서 공유.

/** 만료 임박으로 경고할 기준 일수 (만료일까지 이 일수 이하로 남으면 임박) */
export const EXPIRY_WARN_DAYS = 30;

/**
 * 오늘(자정 기준) 대비 만료일까지 남은 일수. 음수면 이미 만료.
 * 날짜 문자열(YYYY-MM-DD 등)이 비었거나 파싱 불가면 null.
 */
export function daysUntilExpiry(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(t);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** 남은 일수가 경고 대상(만료 또는 임박)인지 */
export function isExpiryAlert(daysLeft: number | null): daysLeft is number {
  return daysLeft != null && daysLeft <= EXPIRY_WARN_DAYS;
}
