export interface CategoryItem { code: string; label: string; }

export interface CategoryStore {
  major: CategoryItem[];
  mid: Record<string, CategoryItem[]>;
  sub: Record<string, CategoryItem[]>;
}

const store: CategoryStore = {
  major: [
    { code: "01", label: "기계실" },
    { code: "02", label: "승강로" },
    { code: "03", label: "승강카" },
    { code: "04", label: "승강장" },
    { code: "05", label: "피트" },
    { code: "99", label: "범용" },
  ],
  mid: {
    "01": [
      { code: "01", label: "권상기" },
      { code: "02", label: "제어반" },
      { code: "03", label: "조속기" },
      { code: "04", label: "로프" },
      { code: "05", label: "기타 설비" },
    ],
    "02": [
      { code: "01", label: "가이드 레일" },
      { code: "02", label: "균형추" },
      { code: "03", label: "케이블/배선" },
      { code: "04", label: "안전 스위치" },
      { code: "05", label: "기타" },
    ],
    "03": [
      { code: "01", label: "카 프레임" },
      { code: "02", label: "가이드 장치" },
      { code: "03", label: "안전장치" },
      { code: "04", label: "카 도어" },
      { code: "05", label: "카 인테리어" },
      { code: "06", label: "카 조작/표시" },
      { code: "07", label: "카 상부" },
    ],
    "04": [
      { code: "01", label: "승강장 도어" },
      { code: "02", label: "호출/표시" },
      { code: "03", label: "안전/기타" },
    ],
    "05": [
      { code: "01", label: "버퍼" },
      { code: "02", label: "텐션 장치" },
      { code: "03", label: "안전 장치" },
      { code: "04", label: "기타 설비" },
    ],
    "99": [
      { code: "01", label: "공기구" },
      { code: "02", label: "근무복 및 안전용품" },
      { code: "03", label: "소모품" },
    ],
  },
  sub: {
    "0101": [
      { code: "01", label: "권상기 본체" },
      { code: "02", label: "권상기 모터" },
      { code: "03", label: "감속기" },
      { code: "04", label: "메인 시브" },
      { code: "05", label: "디플렉터 시브" },
      { code: "06", label: "브레이크 장치" },
      { code: "07", label: "브레이크 라이닝" },
      { code: "08", label: "브레이크 코일" },
      { code: "09", label: "모터 베어링" },
      { code: "10", label: "커플링" },
      { code: "11", label: "엔코더" },
      { code: "12", label: "수동 핸들" },
      { code: "99", label: "기타" },
    ],
    "0102": [
      { code: "01", label: "제어반 본체" },
      { code: "02", label: "메인 CPU 보드" },
      { code: "03", label: "인버터" },
      { code: "04", label: "전원 공급 장치" },
      { code: "05", label: "변압기" },
      { code: "06", label: "노이즈 필터" },
      { code: "07", label: "마그네틱 컨택터" },
      { code: "08", label: "릴레이" },
      { code: "09", label: "써킷 브레이커" },
      { code: "10", label: "퓨즈" },
      { code: "11", label: "단자대" },
      { code: "12", label: "통신 모듈" },
      { code: "13", label: "UPS/비상전원" },
      { code: "14", label: "ARD 장치" },
      { code: "99", label: "기타" },
    ],
    "0103": [
      { code: "01", label: "조속기 본체" },
      { code: "02", label: "조속기 시브" },
      { code: "03", label: "조속기 로프" },
      { code: "04", label: "조속기 스위치" },
      { code: "05", label: "조속기 텐션 시브" },
      { code: "06", label: "조속기 텐션 웨이트" },
      { code: "07", label: "캐치 장치" },
      { code: "99", label: "기타" },
    ],
    "0104": [
      { code: "01", label: "메인 로프" },
      { code: "02", label: "보상 로프" },
      { code: "03", label: "보상 체인" },
      { code: "04", label: "로프 패스너" },
      { code: "05", label: "로프 가드" },
      { code: "06", label: "기타" },
    ],
    "0105": [
      { code: "01", label: "기계실 조명" },
      { code: "02", label: "환기 장치" },
      { code: "03", label: "기계실 콘센트" },
      { code: "04", label: "기계실 출입문" },
      { code: "05", label: "방진 패드" },
      { code: "06", label: "주개폐기" },
      { code: "99", label: "기타" },
    ],
    "0201": [
      { code: "01", label: "카 가이드 레일" },
      { code: "02", label: "균형추 가이드 레일" },
      { code: "03", label: "레일 브라켓" },
      { code: "04", label: "레일 클립" },
      { code: "05", label: "레일 조인트" },
      { code: "06", label: "앵커 볼트" },
      { code: "99", label: "기타" },
    ],
    "0202": [
      { code: "01", label: "균형추 프레임" },
      { code: "02", label: "균형추 웨이트" },
      { code: "03", label: "균형추 가이드 슈" },
      { code: "04", label: "균형추 안전장치" },
      { code: "05", label: "기타" },
    ],
    "0203": [
      { code: "01", label: "트래블링 케이블" },
      { code: "02", label: "케이블 행거" },
      { code: "03", label: "정션 박스" },
      { code: "04", label: "승강로 배선" },
      { code: "99", label: "기타" },
    ],
    "0204": [
      { code: "01", label: "상부 리미트 스위치" },
      { code: "02", label: "하부 리미트 스위치" },
      { code: "03", label: "파이널 리미트 스위치" },
      { code: "04", label: "감속 스위치" },
      { code: "05", label: "층 위치 센서" },
      { code: "06", label: "레벨링 센서" },
      { code: "07", label: "기타" },
    ],
    "0205": [
      { code: "01", label: "승강로 조명" },
      { code: "02", label: "구분 보" },
      { code: "03", label: "승강로 환기구" },
      { code: "99", label: "기타" },
    ],
    "0301": [
      { code: "01", label: "카 프레임" },
      { code: "02", label: "크로스헤드" },
      { code: "03", label: "세이프티 플랭크" },
      { code: "04", label: "수직 채널" },
      { code: "05", label: "카 플랫폼" },
      { code: "06", label: "방진 고무" },
      { code: "99", label: "기타" },
    ],
    "0302": [
      { code: "01", label: "롤러 가이드 슈" },
      { code: "02", label: "슬라이딩 가이드 슈" },
      { code: "03", label: "가이드 슈 라이너" },
      { code: "99", label: "기타" },
    ],
    "0303": [
      { code: "01", label: "비상정지장치" },
      { code: "02", label: "점진식 안전장치" },
      { code: "03", label: "즉시식 안전장치" },
      { code: "04", label: "과부하 감지장치" },
      { code: "05", label: "도어 인터록" },
      { code: "06", label: "로프 이완 감지" },
      { code: "99", label: "기타" },
    ],
    "0304": [
      { code: "01", label: "카 도어 패널" },
      { code: "02", label: "도어 오퍼레이터" },
      { code: "03", label: "도어 모터" },
      { code: "04", label: "도어 행거" },
      { code: "05", label: "도어 행거 롤러" },
      { code: "06", label: "도어 트랙" },
      { code: "07", label: "도어 실" },
      { code: "08", label: "도어 가이드 슈" },
      { code: "09", label: "광전 센서" },
      { code: "10", label: "세이프티 슈" },
      { code: "11", label: "도어 클로저" },
      { code: "12", label: "도어 벨트" },
      { code: "99", label: "기타" },
    ],
    "0305": [
      { code: "01", label: "카 벽 패널" },
      { code: "02", label: "천장 패널" },
      { code: "03", label: "바닥재" },
      { code: "04", label: "거울" },
      { code: "05", label: "핸드레일" },
      { code: "06", label: "카 조명" },
      { code: "07", label: "환기 팬" },
      { code: "08", label: "걸레받이" },
      { code: "99", label: "기타" },
    ],
    "0306": [
      { code: "01", label: "카 조작반(COP)" },
      { code: "02", label: "층 버튼" },
      { code: "03", label: "도어 개폐 버튼" },
      { code: "04", label: "비상 통화 버튼" },
      { code: "05", label: "위치 표시기" },
      { code: "06", label: "방향 표시등" },
      { code: "07", label: "도착 종/차임" },
      { code: "08", label: "음성 안내장치" },
      { code: "09", label: "인터폰" },
      { code: "10", label: "CCTV 카메라" },
      { code: "11", label: "비상등" },
      { code: "12", label: "비상벨" },
      { code: "99", label: "기타" },
    ],
    "0307": [
      { code: "01", label: "카 상부 점검 스위치" },
      { code: "02", label: "카 상부 비상정지" },
      { code: "03", label: "카 상부 안전 난간" },
      { code: "04", label: "카 상부 콘센트" },
      { code: "05", label: "카 상부 조명" },
      { code: "99", label: "기타" },
    ],
    "0401": [
      { code: "01", label: "승강장 도어 패널" },
      { code: "02", label: "도어 프레임(잼)" },
      { code: "03", label: "트랜섬" },
      { code: "04", label: "승강장 도어 행거" },
      { code: "05", label: "승강장 도어 실" },
      { code: "06", label: "도어 인터록 스위치" },
      { code: "07", label: "비상 해정장치" },
      { code: "08", label: "도어 클로저" },
      { code: "09", label: "도어 가이드 슈" },
      { code: "99", label: "기타" },
    ],
    "0402": [
      { code: "01", label: "홀 버튼/호출버튼" },
      { code: "02", label: "상승 버튼" },
      { code: "03", label: "하강 버튼" },
      { code: "04", label: "홀 위치 표시기" },
      { code: "05", label: "방향 표시등(홀랜턴)" },
      { code: "06", label: "도착 차임" },
      { code: "07", label: "점자 표시" },
      { code: "99", label: "기타" },
    ],
    "0403": [
      { code: "01", label: "승강장 조명" },
      { code: "02", label: "비상 키 스위치" },
      { code: "03", label: "소방운전 스위치" },
      { code: "04", label: "층 표시판" },
      { code: "05", label: "주의 표시판" },
      { code: "99", label: "기타" },
    ],
    "0501": [
      { code: "01", label: "카 버퍼" },
      { code: "02", label: "균형추 버퍼" },
      { code: "03", label: "유압 버퍼" },
      { code: "04", label: "스프링 버퍼" },
      { code: "05", label: "폴리우레탄 버퍼" },
      { code: "06", label: "버퍼 스탠드" },
      { code: "07", label: "버퍼 스위치" },
      { code: "99", label: "기타" },
    ],
    "0502": [
      { code: "01", label: "조속기 텐션 시브" },
      { code: "02", label: "조속기 텐션 웨이트" },
      { code: "03", label: "보상 로프 시브" },
      { code: "04", label: "보상 시브 가드" },
      { code: "05", label: "텐션 스위치" },
      { code: "99", label: "기타" },
    ],
    "0503": [
      { code: "01", label: "피트 정지 스위치" },
      { code: "02", label: "피트 점검운전 스위치" },
      { code: "03", label: "피트 콘센트" },
      { code: "04", label: "최하층 강제 감속 스위치" },
      { code: "05", label: "균형추 가드" },
      { code: "99", label: "기타" },
    ],
    "0504": [
      { code: "01", label: "피트 조명" },
      { code: "02", label: "피트 사다리" },
      { code: "03", label: "배수 장치/집수정" },
      { code: "04", label: "방수 처리" },
      { code: "05", label: "피트 청소구" },
      { code: "06", label: "레일 받침대" },
      { code: "99", label: "기타" },
    ],
    "9901": [
      { code: "01", label: "측정 및 검사장비" },
      { code: "02", label: "수공구" },
      { code: "03", label: "전동공구" },
      { code: "04", label: "등록장비" },
      { code: "99", label: "기타" },
    ],
    "9902": [
      { code: "01", label: "하계 상의" },
      { code: "02", label: "하계 하의" },
      { code: "03", label: "동계 상의" },
      { code: "04", label: "동계 하의" },
      { code: "05", label: "춘추 점퍼" },
      { code: "06", label: "안전화" },
      { code: "07", label: "안전모" },
      { code: "08", label: "안전벨트" },
      { code: "09", label: "장갑류" },
      { code: "99", label: "기타" },
    ],
    "9903": [
      { code: "01", label: "볼트" },
      { code: "02", label: "너트" },
      { code: "99", label: "기타" },
    ],
  },
};

export function getCategories(): CategoryStore {
  return store;
}

function nextCode(items: CategoryItem[]): string {
  const nums = items.map(i => parseInt(i.code, 10)).filter(Number.isFinite);
  const max = nums.length ? Math.max(...nums) : 0;
  return String(max + 1).padStart(2, "0");
}

export function addMajor(label: string): CategoryItem {
  const code = nextCode(store.major);
  const item = { code, label };
  store.major.push(item);
  store.mid[code] = [];
  return item;
}

export function updateMajor(code: string, label: string): boolean {
  const item = store.major.find(i => i.code === code);
  if (!item) return false;
  item.label = label;
  return true;
}

export function deleteMajor(code: string): boolean {
  const idx = store.major.findIndex(i => i.code === code);
  if (idx === -1) return false;
  store.major.splice(idx, 1);
  delete store.mid[code];
  Object.keys(store.sub).filter(k => k.startsWith(code)).forEach(k => delete store.sub[k]);
  return true;
}

export function addMid(majorCode: string, label: string): CategoryItem {
  if (!store.mid[majorCode]) store.mid[majorCode] = [];
  const code = nextCode(store.mid[majorCode]);
  const item = { code, label };
  store.mid[majorCode].push(item);
  store.sub[`${majorCode}${code}`] = [];
  return item;
}

export function updateMid(majorCode: string, code: string, label: string): boolean {
  const item = store.mid[majorCode]?.find(i => i.code === code);
  if (!item) return false;
  item.label = label;
  return true;
}

export function deleteMid(majorCode: string, code: string): boolean {
  const list = store.mid[majorCode];
  if (!list) return false;
  const idx = list.findIndex(i => i.code === code);
  if (idx === -1) return false;
  list.splice(idx, 1);
  delete store.sub[`${majorCode}${code}`];
  return true;
}

export function addSub(majorCode: string, midCode: string, label: string): CategoryItem {
  const key = `${majorCode}${midCode}`;
  if (!store.sub[key]) store.sub[key] = [];
  const code = nextCode(store.sub[key]);
  const item = { code, label };
  store.sub[key].push(item);
  return item;
}

export function updateSub(majorCode: string, midCode: string, code: string, label: string): boolean {
  const item = store.sub[`${majorCode}${midCode}`]?.find(i => i.code === code);
  if (!item) return false;
  item.label = label;
  return true;
}

export function deleteSub(majorCode: string, midCode: string, code: string): boolean {
  const key = `${majorCode}${midCode}`;
  const list = store.sub[key];
  if (!list) return false;
  const idx = list.findIndex(i => i.code === code);
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}
