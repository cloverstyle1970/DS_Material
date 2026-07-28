// 근로 시간 계산 유틸
// ------------------------------------------------------------
// 사업장 정책: 4시간 근무 후 30분 휴게 사이클을 반복한다.
//   0~240분(4h):        정근무만
//   240~270분(4h~4h30): 초과 분만큼 휴게로 차감 (최대 30분)
//   270~510분(4h30~8h30): 다시 정근무
//   510~540분(8h30~9h): 초과 분만큼 두 번째 휴게 차감 (최대 30분)
//   ... 이 패턴 반복.
// 예) 4시간(240m):       0분 차감 → 실질 240m
//     4시간 1분(241m):   1분 차감 → 실질 240m
//     4시간 30분(270m):  30분 차감 → 실질 240m
//     8시간(480m):       30분 차감 → 실질 450m
//     9시간(540m):       60분 차감 → 실질 480m
//     12시간(720m):      60분 차감 → 실질 660m

/**
 * 근무 시작·종료(HH:MM 24h)로부터 순 근무 분을 계산한다.
 * - 시작이 종료보다 늦으면 자정 넘김으로 간주해 24시간을 더한다.
 * - 값이 비었으면 null 반환.
 */
export function netWorkMinutes(startHM: string, endHM: string): number | null {
  if (!startHM || !endHM) return null;
  const [sh, sm] = startHM.split(":").map(v => Number(v));
  const [eh, em] = endHM.split(":").map(v => Number(v));
  if ([sh, sm, eh, em].some(v => !Number.isFinite(v))) return null;
  let totalMin = eh * 60 + em - (sh * 60 + sm);
  if (totalMin < 0) totalMin += 24 * 60; // 자정 넘김
  if (totalMin === 0) return 0;

  // 270분(4시간 근무 + 30분 휴게) 사이클 반복
  const cycles = Math.floor(totalMin / 270);
  const remainder = totalMin - cycles * 270;
  const partialBreak = Math.min(30, Math.max(0, remainder - 240));
  const breaks = cycles * 30 + partialBreak;

  return Math.max(0, totalMin - breaks);
}

/** 분 → { hours, minutes } */
export function splitHM(totalMin: number): { hours: number; minutes: number } {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return { hours: h, minutes: m };
}
