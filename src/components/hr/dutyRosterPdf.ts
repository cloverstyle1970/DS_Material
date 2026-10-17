// 근무표 PDF(엑셀에서 PDF로 저장한 텍스트 PDF) → 엑셀 파서와 같은 표 구조(aoa + 열별 머리글)로 변환.
// PDF 에는 칸 정보가 없으므로 글자 위치로 표를 복원한다.
//  1) 날짜 숫자(1~31)가 있는 줄 = 데이터 행, 이름은 y 가 가장 가까운 날짜 행에 붙임
//  2) 이름 x 중심을 묶어 열을 찾고, 최소 간격(=칸 너비)으로 빈 열까지 채워 등간격 격자 복원
//  3) 머리글(사무실 숙직·숙직보조·파주 대기·야간점검)마다, 연속 열 묶음의 중심이 머리글 중심과
//     가장 가까운 칸 수를 골라 병합 범위를 정함 (마지막 머리글은 나머지 열 전부)
// 스캔(이미지) PDF 는 글자가 없어 읽을 수 없다.

export interface PdfTextItem { str: string; x: number; y: number; w: number; }
export interface SheetLike { aoa: unknown[][]; groups: string[]; headerIdx: number; dateCol: number; }

const isDay = (s: string) => /^\d{1,2}$/.test(s) && +s >= 1 && +s <= 31;
const isName = (s: string) => /^[가-힣]{2,5}$/.test(s);
const DOWS = "일월화수목금토";

export function pdfItemsToSheet(items: PdfTextItem[]): SheetLike | { error: string } {
  const cx = (i: PdfTextItem) => i.x + i.w / 2;

  // 제목: 같은 줄 글자를 이어 붙여 "26년 11월" 찾기
  const lines = new Map<number, PdfTextItem[]>();
  for (const it of items) {
    const key = [...lines.keys()].find(y => Math.abs(y - it.y) <= 3) ?? it.y;
    lines.set(key, [...(lines.get(key) ?? []), it]);
  }
  const title = [...lines.values()]
    .map(l => l.sort((a, b) => a.x - b.x).map(i => i.str).join("").replace(/\s/g, ""))
    .find(t => /\d{2,4}년\d{1,2}월/.test(t)) ?? "";

  // 날짜 머리글 → 날짜 열 x
  const dateHeader = items.find(i => /^날짜/.test(i.str.trim()));
  if (!dateHeader) return { error: "PDF에서 '날짜' 머리글을 찾을 수 없습니다. 근무표 양식의 텍스트 PDF인지 확인해 주세요." };
  const dayItems = items.filter(i => isDay(i.str.trim()) && i.y < dateHeader.y && Math.abs(i.x - dateHeader.x) < 40);
  if (!dayItems.length) return { error: "PDF에서 날짜 행을 찾을 수 없습니다." };
  const firstRowY = Math.max(...dayItems.map(i => i.y));
  const dowItems = items.filter(i => i.str.trim().length === 1 && DOWS.includes(i.str.trim()) && i.y <= firstRowY + 3);
  const dowRight = Math.max(dateHeader.x + dateHeader.w, ...dowItems.map(i => i.x + i.w));

  // 이름 → 가장 가까운 날짜 행
  const names = items.filter(i => isName(i.str.trim()) && i.y <= firstRowY + 5 && i.x > dowRight);
  if (!names.length) return { error: "PDF에서 근무자 이름을 찾을 수 없습니다." };

  // 열 격자 복원
  const centers: number[] = [];
  for (const c of names.map(cx).sort((a, b) => a - b)) {
    if (!centers.length || c - centers[centers.length - 1] > 8) centers.push(c);
    else centers[centers.length - 1] = (centers[centers.length - 1] + c) / 2;
  }
  const gaps = centers.slice(1).map((c, i) => c - centers[i]);
  const w = gaps.length ? Math.min(...gaps) : 50;

  // 머리글: 데이터 첫 행과 제목 사이, 날짜·요일 제외. 붙어 있거나 위아래로 겹친 글자(파주/대기)는 하나로
  const headerItems = items
    .filter(i => i.y > firstRowY + 6 && i.y <= dateHeader.y + 20 && i.x > dowRight - 5)
    .filter(i => !/^(날짜|요일|날짜 요일)$/.test(i.str.trim()))
    .sort((a, b) => a.x - b.x);
  const labels: { text: string; l: number; r: number }[] = [];
  for (const it of headerItems) {
    const last = labels[labels.length - 1];
    if (last && it.x <= last.r + w * 0.25) {
      last.text += (it.x > last.r ? " " : "") + it.str.trim();
      last.r = Math.max(last.r, it.x + it.w);
    } else labels.push({ text: it.str.trim(), l: it.x, r: it.x + it.w });
  }
  if (!labels.length) return { error: "PDF에서 근무 구분 머리글을 찾을 수 없습니다." };

  // 격자: 첫 이름 열부터 등간격, 마지막 머리글 오른쪽 끝까지
  const right = Math.max(labels[labels.length - 1].r, centers[centers.length - 1]);
  const grid: number[] = [];
  for (let c = centers[0]; c <= right + w / 2; c += w) grid.push(c);

  // 머리글별 열 범위
  const colGroup: string[] = new Array(grid.length).fill("");
  let i = 0;
  labels.forEach((lb, li) => {
    if (i >= grid.length) return;
    const center = (lb.l + lb.r) / 2;
    let span = grid.length - i;
    if (li < labels.length - 1) {
      let best = 1, bestErr = Infinity;
      for (let s = 1; s <= Math.min(6, grid.length - i); s++) {
        const mean = grid.slice(i, i + s).reduce((t, x) => t + x, 0) / s;
        const err = Math.abs(mean - center);
        if (err < bestErr - 0.5) { best = s; bestErr = err; }
      }
      span = best;
    }
    for (let k = i; k < i + span; k++) colGroup[k] = lb.text;
    i += span;
  });

  // 행 구성: [날짜, 요일, 열1, 열2, ...]
  const rows = dayItems.sort((a, b) => b.y - a.y).map(d => {
    const row: string[] = [d.str.trim(), "", ...grid.map(() => "")];
    const dow = dowItems.find(x => Math.abs(x.y - d.y) <= 4);
    if (dow) row[1] = dow.str.trim();
    return row;
  });
  for (const n of names) {
    let best = 0, bestD = Infinity;
    dayItems.forEach((d, k) => { const dd = Math.abs(d.y - n.y); if (dd < bestD) { bestD = dd; best = k; } });
    if (bestD > 8) continue;
    let col = 0, colD = Infinity;
    grid.forEach((g, k) => { const dd = Math.abs(g - cx(n)); if (dd < colD) { colD = dd; col = k; } });
    const cell = rows[best][2 + col];
    rows[best][2 + col] = cell ? `${cell},${n.str.trim()}` : n.str.trim();
  }

  return {
    aoa: [[title], ["날짜", "요일", ...colGroup], ...rows],
    groups: ["날짜", "요일", ...colGroup],
    headerIdx: 1,
    dateCol: 0,
  };
}

// 브라우저에서 PDF 1쪽의 글자와 위치를 읽는다 (pdfjs-dist)
export async function readPdfItems(file: File): Promise<PdfTextItem[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const out: PdfTextItem[] = [];
  for (const it of tc.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    out.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
  }
  await doc.destroy();
  return out;
}
