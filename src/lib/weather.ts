// 현재 위치의 실시간 기상정보를 가져온다.
// Open-Meteo (https://open-meteo.com) — API 키 불필요, CORS 지원, 상용 무료.
// 좌표는 브라우저 Geolocation API로 획득 (HTTPS/localhost 에서만 동작).

export interface WeatherNow {
  temperature: number;      // ℃
  humidity: number;         // %
  weatherCode: number;      // WMO code
  weatherLabel: string;     // 한국어 설명
  observedAt: string;       // ISO
  location: string;         // "서울특별시 강남구" 등 (실패 시 빈 문자열)
}

// WMO Weather interpretation code → 한글
// https://open-meteo.com/en/docs (Weather variable documentation)
const WEATHER_LABELS: Record<number, string> = {
  0:  "맑음",
  1:  "대체로 맑음",
  2:  "부분 흐림",
  3:  "흐림",
  45: "안개",
  48: "짙은 안개",
  51: "약한 이슬비",
  53: "이슬비",
  55: "강한 이슬비",
  56: "얼음 이슬비",
  57: "강한 얼음 이슬비",
  61: "약한 비",
  63: "비",
  65: "강한 비",
  66: "얼음 비",
  67: "강한 얼음 비",
  71: "약한 눈",
  73: "눈",
  75: "폭설",
  77: "싸락눈",
  80: "약한 소나기",
  81: "소나기",
  82: "강한 소나기",
  85: "약한 눈 소나기",
  86: "강한 눈 소나기",
  95: "뇌우",
  96: "우박 뇌우",
  99: "강한 우박 뇌우",
};

export function labelForWeatherCode(code: number): string {
  return WEATHER_LABELS[code] ?? "";
}

export async function getCurrentPositionAsync(): Promise<GeolocationPosition> {
  if (typeof window === "undefined" || !("geolocation" in navigator)) {
    throw new Error("이 브라우저는 위치 정보를 지원하지 않습니다.");
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, err => {
      // 브라우저별 code: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
      let msg = "위치 정보를 가져오지 못했습니다.";
      if (err.code === 1) msg = "위치 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.";
      else if (err.code === 2) msg = "현재 위치를 확인할 수 없습니다.";
      else if (err.code === 3) msg = "위치 확인 시간이 초과되었습니다.";
      reject(new Error(msg));
    }, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 60_000,
    });
  });
}

// BigDataCloud 무료 reverse-geocoding (API 키 불필요, CORS 지원, 한국어).
// 실패해도 예외를 던지지 않고 빈 문자열 반환.
export async function fetchLocationLabel(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client`
      + `?latitude=${lat}&longitude=${lon}&localityLanguage=ko`;
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json() as {
      principalSubdivision?: string;   // 서울특별시 / 경기도 …
      locality?: string;               // 강남구 / 성남시 분당구 …
      city?: string;                   // 서울
      countryName?: string;
    };
    const sub = (data.principalSubdivision ?? "").trim();
    const loc = (data.locality ?? data.city ?? "").trim();
    if (sub && loc) return `${sub} ${loc}`;
    return sub || loc || "";
  } catch {
    return "";
  }
}

export async function fetchWeatherAt(lat: number, lon: number): Promise<WeatherNow> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,weather_code`
    + `&timezone=Asia%2FSeoul`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`기상 API 오류 (HTTP ${res.status})`);
  const data = await res.json() as {
    current?: {
      time?: string;
      temperature_2m?: number;
      relative_humidity_2m?: number;
      weather_code?: number;
    };
  };
  const c = data.current;
  if (!c || c.temperature_2m == null || c.relative_humidity_2m == null) {
    throw new Error("기상 API 응답이 비어있습니다.");
  }
  return {
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    weatherCode: c.weather_code ?? -1,
    weatherLabel: c.weather_code != null ? labelForWeatherCode(c.weather_code) : "",
    observedAt: c.time ?? new Date().toISOString(),
    location: "",
  };
}

// 편의 함수: 위치 획득 + 기상 API + 지역명(reverse-geocode) 병렬
export async function fetchCurrentWeather(): Promise<WeatherNow> {
  const pos = await getCurrentPositionAsync();
  const { latitude: lat, longitude: lon } = pos.coords;
  const [weather, location] = await Promise.all([
    fetchWeatherAt(lat, lon),
    fetchLocationLabel(lat, lon),
  ]);
  return { ...weather, location };
}
