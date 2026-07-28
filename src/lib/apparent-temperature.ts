// 체감온도(Perceived Temperature) 계산
// 산업안전보건공단·기상청 2023 개정 여름철 체감온도 공식 (온도·습도 기반)
// 참조: 산업안전보건공단 「고온 작업 근로자 온열질환 예방 가이드」
//
// Tw = T·atan[0.151977·(RH+8.313659)^0.5]
//    + atan(T+RH) − atan(RH−1.67633)
//    + 0.00391838·RH^1.5·atan(0.023101·RH)
//    − 4.686035
// PT = -0.2442 + 0.55399·Tw + 0.45535·T
//    − 0.0022·Tw² + 0.00278·Tw·T + 3.0
//
// 온도 < 15℃ 또는 습도 범위 밖이면 계산하지 않음 (기상청도 겨울철은 풍속 기반 별도식이라 풍속 없이 산출 불가).
// 이 경우 null 반환 → UI가 자동 채움을 건너뛰고 사용자 수동 입력 유지.

export function calcApparentTemperature(
  temperatureC: number,
  humidityPct: number,
): number | null {
  if (!Number.isFinite(temperatureC) || !Number.isFinite(humidityPct)) return null;
  if (humidityPct < 0 || humidityPct > 100) return null;
  // 온도 15℃ 미만이면 여름철 공식 적용 대상이 아님 (기상청 기준상 여름철 체감온도는 20℃+에서 유효)
  if (temperatureC < 15) return null;

  const T = temperatureC;
  const RH = humidityPct;

  const Tw =
    T * Math.atan(0.151977 * Math.pow(RH + 8.313659, 0.5)) +
    Math.atan(T + RH) -
    Math.atan(RH - 1.67633) +
    0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
    4.686035;

  const PT =
    -0.2442 +
    0.55399 * Tw +
    0.45535 * T -
    0.0022 * Tw * Tw +
    0.00278 * Tw * T +
    3.0;

  return Math.round(PT * 10) / 10; // 소수 1자리
}

// 온열질환 예방 4단계 (산업안전보건공단 「고온 작업 근로자 온열질환 예방 가이드」)
// - 적정(관심): 체감온도 31℃ 미만
// - 주의:      31℃ 이상 ~ 33℃ 미만  → 매시간 10분씩 그늘 휴식 권장
// - 경고:      33℃ 이상 ~ 35℃ 미만  → 매시간 15분씩, 옥외 오후시간대 자제
// - 위험:      35℃ 이상              → 옥외작업 중지 검토, 매시간 20분 이상 휴식

export type HeatStressLevel = "safe" | "caution" | "warning" | "danger";

export interface HeatStressInfo {
  level: HeatStressLevel;
  label: string;      // "적정" | "주의" | "경고" | "위험"
  advice: string;     // 짧은 대응 문구
  colorClass: string; // Tailwind 배경/글자 색 (라이트+다크 모두 포함)
}

export function heatStressLevel(perceivedTempC: number | null | undefined): HeatStressInfo | null {
  if (perceivedTempC == null || !Number.isFinite(perceivedTempC)) return null;
  if (perceivedTempC >= 35) return {
    level: "danger", label: "위험",
    advice: "옥외작업 중지 검토, 매시간 20분 이상 휴식",
    colorClass: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700",
  };
  if (perceivedTempC >= 33) return {
    level: "warning", label: "경고",
    advice: "매시간 15분씩 그늘 휴식, 오후 옥외작업 자제",
    colorClass: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700",
  };
  if (perceivedTempC >= 31) return {
    level: "caution", label: "주의",
    advice: "매시간 10분씩 그늘 휴식 권장",
    colorClass: "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700",
  };
  return {
    level: "safe", label: "적정",
    advice: "정상 작업 가능",
    colorClass: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700",
  };
}
