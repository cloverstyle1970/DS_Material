import { heatStressLevel } from "@/lib/apparent-temperature";

export interface JournalPrintHeader {
  id: number;
  user_name: string;
  work_date: string;
  weekday: string | null;
  weather: string | null;
  site_name: string;
  elevator_unique_no: string;
  temperature: number | null;
  humidity: number | null;
  apparent_temperature: number | null;
  base_work_start: string | null;
  base_work_end: string | null;
  overtime_start: string | null;
  overtime_end: string | null;
  overtime_hours: number;
  overtime_minutes: number;
  category_inspection: boolean;
  category_fault: boolean;
  category_repair: boolean;
  special_notes: string;
  location: string | null;
  created_at: string;
}

export interface JournalPrintItem {
  seq: number;
  unit_no: string;
  work_category: string;
  work_content: string;
  work_start: string | null;
  work_end: string | null;
  action_result: string;
}

export interface JournalPrintEnv {
  seq: number;
  observed_at: string | null;
  temperature: number | null;
  humidity: number | null;
  apparent_temperature: number | null;
  location: string | null;
}

export interface JournalPrintRest {
  seq: number;
  rest_start: string | null;
  rest_end: string | null;
  rest_method: string | null;
}

export interface JournalPrintParticipant {
  role: string;
  name: string;
  signature_url: string | null;
}

export interface WorkJournalPrintData {
  header: JournalPrintHeader;
  items: JournalPrintItem[];
  envReadings: JournalPrintEnv[];
  rests: JournalPrintRest[];
  participants: JournalPrintParticipant[];
}

export function printWorkJournal(data: WorkJournalPrintData) {
  const { header: r, items, envReadings, rests, participants } = data;

  const esc = (s: unknown) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const t5 = (s: string | null | undefined) => (s ? s.slice(0, 5) : "");

  const cats: string[] = [];
  if (r.category_inspection) cats.push("점검");
  if (r.category_fault) cats.push("고장처리");
  if (r.category_repair) cats.push("수리공사");
  const catLabel = cats.length ? cats.join(", ") : "-";

  const docNo = `WJ-${r.work_date.replace(/-/g, "")}-${r.id}`;

  const overtimeText =
    r.overtime_start || r.overtime_end
      ? `${t5(r.overtime_start) || "-"} ~ ${t5(r.overtime_end) || "-"}` +
        (r.overtime_hours > 0 || r.overtime_minutes > 0
          ? ` (${r.overtime_hours}시간 ${r.overtime_minutes}분)`
          : "")
      : "-";

  const weatherText = r.weather
    ? `${esc(r.weather)}` +
      (r.temperature !== null ? ` · 온도 ${r.temperature}℃` : "") +
      (r.humidity !== null ? ` · 습도 ${r.humidity}%` : "") +
      (r.apparent_temperature !== null
        ? ` · 체감 ${r.apparent_temperature}℃`
        : "")
    : "-";

  const envBlock =
    envReadings.length > 0
      ? `<div class="sec">
        <div class="sec-h">기상정보 (${envReadings.length}건)</div>
        <table class="grid">
          <thead>
            <tr>
              <th style="width:14%">시각</th>
              <th style="width:14%">온도(℃)</th>
              <th style="width:14%">습도(%)</th>
              <th style="width:24%">체감온도</th>
              <th>지역정보</th>
            </tr>
          </thead>
          <tbody>
            ${envReadings
              .map((x) => {
                const info = heatStressLevel(x.apparent_temperature);
                const level = info ? ` (${info.label})` : "";
                return `<tr>
                  <td>${esc(t5(x.observed_at) || "-")}</td>
                  <td>${x.temperature ?? "-"}</td>
                  <td>${x.humidity ?? "-"}</td>
                  <td>${x.apparent_temperature ?? "-"}${esc(level)}</td>
                  <td class="l">${esc(x.location ?? "-")}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`
      : "";

  const itemsBlock =
    items.length > 0
      ? `<div class="sec">
        <div class="sec-h">작업 내역 (${items.length}건)</div>
        <table class="grid">
          <thead>
            <tr>
              <th style="width:10%">호기</th>
              <th style="width:14%">구분</th>
              <th>작업내용</th>
              <th style="width:20%">작업시간</th>
              <th style="width:22%">조치결과</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map((it) => {
                const time =
                  it.work_start || it.work_end
                    ? `${t5(it.work_start) || "-"} ~ ${t5(it.work_end) || "-"}`
                    : "-";
                return `<tr>
                  <td>${esc(it.unit_no)}</td>
                  <td>${esc(it.work_category)}</td>
                  <td class="l">${esc(it.work_content)}</td>
                  <td>${esc(time)}</td>
                  <td class="l">${esc(it.action_result)}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`
      : "";

  const restRows = rests.filter(
    (x) => x.rest_start || x.rest_end || x.rest_method,
  );
  const restsBlock =
    restRows.length > 0
      ? `<div class="sec">
        <div class="sec-h">온열질환 예방 휴게 실시 (${restRows.length}건)</div>
        <table class="grid">
          <thead>
            <tr>
              <th style="width:20%">시작</th>
              <th style="width:20%">종료</th>
              <th>휴게방법</th>
            </tr>
          </thead>
          <tbody>
            ${restRows
              .map(
                (x) => `<tr>
                <td>${esc(t5(x.rest_start) || "-")}</td>
                <td>${esc(t5(x.rest_end) || "-")}</td>
                <td class="l">${esc(x.rest_method ?? "-")}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
      : "";

  const notesBlock = r.special_notes
    ? `<div class="sec">
        <div class="sec-h">특이사항</div>
        <div class="sec-b pre">${esc(r.special_notes)}</div>
      </div>`
    : "";

  const workers = participants
    .filter((p) => /^worker\d+$/.test(p.role))
    .sort(
      (a, b) =>
        parseInt(a.role.slice(6), 10) - parseInt(b.role.slice(6), 10),
    );
  const participantsBlock =
    workers.length > 0
      ? `<div class="sec">
        <div class="sec-h">참가자 서명 (${workers.length}명)</div>
        <table class="grid sig-table">
          <thead>
            <tr>
              ${workers
                .map(
                  (p) =>
                    `<th>작업자 ${parseInt(p.role.slice(6), 10)}</th>`,
                )
                .join("")}
            </tr>
          </thead>
          <tbody>
            <tr>
              ${workers
                .map(
                  (p) =>
                    `<td class="sig-name">${esc(p.name || "-")}</td>`,
                )
                .join("")}
            </tr>
            <tr>
              ${workers
                .map(
                  (p) =>
                    `<td class="sig-cell">${
                      p.signature_url
                        ? `<img src="${esc(p.signature_url)}" alt="서명" class="sig-mini" />`
                        : `<span class="muted">서명 대기</span>`
                    }</td>`,
                )
                .join("")}
            </tr>
          </tbody>
        </table>
      </div>`
      : "";

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>승강기 유지관리 작업일지 ${esc(docNo)}</title>
  <style>
    *{box-sizing:border-box;font-family:'Malgun Gothic','맑은 고딕',sans-serif;}
    body{margin:12mm;color:#111;font-size:11px;}
    .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}
    h1{font-size:18px;text-align:center;flex:1;margin:0;letter-spacing:3px;}
    .doc{font-size:10px;border:1px solid #333;padding:4px 8px;line-height:1.4;min-width:140px;}
    .sign{border-collapse:collapse;font-size:10px;}
    .sign td{border:1px solid #333;padding:2px 10px;text-align:center;height:36px;}
    .meta{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;}
    .meta td{border:1px solid #333;padding:4px 8px;vertical-align:middle;}
    .meta .h{background:#f0f0f0;font-weight:bold;width:90px;text-align:center;}
    .sec{margin-top:10px;page-break-inside:auto;}
    .sec-h{font-size:11px;font-weight:bold;background:#f0f0f0;border:1px solid #333;padding:4px 8px;}
    .sec-b{border:1px solid #333;border-top:none;padding:6px 8px;min-height:22px;}
    table.grid{width:100%;border-collapse:collapse;font-size:11px;}
    table.grid th,table.grid td{border:1px solid #333;padding:4px 6px;text-align:center;vertical-align:middle;}
    table.grid th{background:#f0f0f0;}
    .l{text-align:left;}
    .pre{white-space:pre-wrap;line-height:1.6;}
    .muted{color:#999;}
    .sig-table td{height:56px;}
    .sig-name{font-weight:bold;height:22px;}
    .sig-cell{padding:2px 4px;}
    .sig-mini{max-height:46px;max-width:120px;background:#fff;}
    @media print{
      body{margin:8mm;}
      .sec{page-break-inside:avoid;}
    }
  </style></head><body>
  <div class="top">
    <div class="doc">문서번호<br><b>${esc(docNo)}</b></div>
    <h1>승강기 유지관리 작업일지</h1>
    <table class="sign"><tr><td>작성</td><td>검토</td><td>승인</td></tr><tr><td></td><td></td><td></td></tr></table>
  </div>
  <table class="meta">
    <tr>
      <td class="h">작업일</td><td>${esc(r.work_date)}${r.weekday ? ` (${esc(r.weekday)})` : ""}</td>
      <td class="h">작성자</td><td>${esc(r.user_name)}</td>
    </tr>
    <tr>
      <td class="h">현장</td><td>${esc(r.site_name)}</td>
      <td class="h">호기</td><td>${esc(r.elevator_unique_no) || "-"}</td>
    </tr>
    <tr>
      <td class="h">작업구분</td><td>${esc(catLabel)}</td>
      <td class="h">날씨</td><td>${weatherText}</td>
    </tr>
    <tr>
      <td class="h">기본근무</td><td>${esc(t5(r.base_work_start) || "-")} ~ ${esc(t5(r.base_work_end) || "-")}</td>
      <td class="h">연장근무</td><td>${esc(overtimeText)}</td>
    </tr>
    ${r.location ? `<tr><td class="h">위치정보</td><td colspan="3">${esc(r.location)}</td></tr>` : ""}
  </table>
  ${envBlock}
  ${itemsBlock}
  ${restsBlock}
  ${notesBlock}
  ${participantsBlock}
  <script>
    window.addEventListener("load", function(){
      var imgs = Array.from(document.images);
      if (imgs.length === 0) { window.print(); return; }
      var remaining = imgs.length;
      var done = false;
      function tryPrint(){ if (done) return; done = true; setTimeout(function(){ window.print(); }, 100); }
      imgs.forEach(function(img){
        if (img.complete) { if (--remaining <= 0) tryPrint(); }
        else {
          img.addEventListener("load",  function(){ if (--remaining <= 0) tryPrint(); });
          img.addEventListener("error", function(){ if (--remaining <= 0) tryPrint(); });
        }
      });
      setTimeout(tryPrint, 8000);
    });
  </script>
  </body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    alert("팝업이 차단되었습니다. 인쇄를 위해 팝업을 허용해주세요.");
    return;
  }
  w.document.write(html);
  w.document.close();
}
