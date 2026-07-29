import type {
  TBMRecord, TBMParticipant, TBMRecordSafetyRule, TBMChecklistResult, TBMPhoto,
  TBMEnvReading, TBMHeatRest,
} from "@/lib/tbm";
import { MODE_LABELS, SUB_TYPE_LABELS } from "@/lib/tbm";
import { heatStressLevel } from "@/lib/apparent-temperature";

export interface TBMReportData {
  record: TBMRecord;
  participants: TBMParticipant[];
  rules: TBMRecordSafetyRule[];
  checklist: TBMChecklistResult[];
  photos: TBMPhoto[];
  envReadings: TBMEnvReading[];
  heatRests: TBMHeatRest[];
}

// TBM 작성일지 인쇄(새 창) — A4 세로 양식.
// 사용자가 인쇄 다이얼로그에서 "PDF로 저장" 선택 시 PDF 파일 생성.
export function printTBMReport(data: TBMReportData) {
  const { record: r, participants, rules, checklist, photos, envReadings, heatRests } = data;

  const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const fmtDt = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  const modeLabel = `${MODE_LABELS[r.mode]}${r.sub_type ? ` · ${SUB_TYPE_LABELS[r.sub_type]}` : ""}`;
  const docNo = `TBM-${fmtDt(r.created_at).replace(/[-: ]/g, "").slice(0, 12)}-${r.id}`;

  const partsRow = r.parts_name
    ? `<tr><td class="h">교체 부품</td><td colspan="3">${esc(r.parts_name)}</td></tr>`
    : "";
  const trappedRow = r.sub_type === "fault"
    ? `<tr><td class="h">승객 갇힘</td><td colspan="3">${r.passenger_trapped ? "🔴 발생" : "없음"}</td></tr>`
    : "";

  const workBlock = `
    <div class="sec">
      <div class="sec-h">작업 내용</div>
      <div class="sec-b pre">${esc(r.work_content) || "—"}</div>
    </div>`;

  const riskBlock = r.risk_assessment
    ? `<div class="sec">
        <div class="sec-h">위험요소 · 특이사항</div>
        <div class="sec-b pre">${esc(r.risk_assessment)}</div>
      </div>`
    : "";

  const envBlock = envReadings.length > 0
    ? `<div class="sec">
        <div class="sec-h">환경지표 (${envReadings.length}건)</div>
        <table class="grid">
          <thead>
            <tr>
              <th style="width:14%">시각</th>
              <th style="width:14%">온도(℃)</th>
              <th style="width:14%">습도(%)</th>
              <th style="width:22%">체감온도</th>
              <th>지역정보</th>
            </tr>
          </thead>
          <tbody>
            ${envReadings.map(x => {
              const info = heatStressLevel(x.apparent_temperature);
              const level = info ? ` (${info.label})` : "";
              return `<tr>
                <td>${esc((x.observed_at ?? "").slice(0,5) || "-")}</td>
                <td>${x.temperature ?? "-"}</td>
                <td>${x.humidity ?? "-"}</td>
                <td>${x.apparent_temperature ?? "-"}${esc(level)}</td>
                <td class="l">${esc(x.location ?? "-")}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`
    : "";

  const heatRestsBlock = heatRests.length > 0
    ? `<div class="sec">
        <div class="sec-h">온열질환 예방 휴게 실시 (${heatRests.length}건)</div>
        <table class="grid">
          <thead>
            <tr>
              <th style="width:20%">시작</th>
              <th style="width:20%">종료</th>
              <th>휴게방법</th>
            </tr>
          </thead>
          <tbody>
            ${heatRests.map(x => `<tr>
              <td>${esc((x.rest_start ?? "").slice(0,5) || "-")}</td>
              <td>${esc((x.rest_end ?? "").slice(0,5) || "-")}</td>
              <td class="l">${esc(x.rest_method ?? "-")}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`
    : "";

  const checklistBlock = checklist.length > 0
    ? `<div class="sec">
        <div class="sec-h">체크리스트 (${checklist.filter(c => c.is_checked).length}/${checklist.length})</div>
        <table class="grid">
          <colgroup><col style="width:36px"><col></colgroup>
          <tbody>
            ${checklist.map(c => `<tr><td class="c">${c.is_checked ? "✓" : "○"}</td><td class="l">${esc(c.item_label)}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>`
    : "";

  const rulesBlock = rules.length > 0
    ? `<div class="sec">
        <div class="sec-h">안전수칙 (${rules.length})</div>
        <ul class="rules">
          ${rules.map(rl => `<li>⚠️ ${esc(rl.rule_text)}</li>`).join("")}
        </ul>
      </div>`
    : "";

  const confirmedCount = participants.filter(p => p.confirmed_at).length;
  const participantsBlock = participants.length > 0
    ? `<div class="sec">
        <div class="sec-h">참가자 확인 (${confirmedCount}/${participants.length})</div>
        <table class="grid">
          <thead><tr><th style="width:30%">성명</th><th style="width:30%">확인 일시</th><th>서명</th></tr></thead>
          <tbody>
            ${participants.map(p => {
              const dt = p.confirmed_at ? fmtDt(p.confirmed_at) : "";
              const sig = p.signature_url
                ? `<img src="${esc(p.signature_url)}" alt="서명" class="sig-mini" />`
                : (p.confirmed_at ? "확인" : "<span class='muted'>미확인</span>");
              return `<tr><td>${esc(p.user_name)}</td><td>${dt || "<span class='muted'>—</span>"}</td><td class="sig-cell">${sig}</td></tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`
    : "";

  const photosBlock = photos.length > 0
    ? `<div class="sec">
        <div class="sec-h">사진 (${photos.length})</div>
        <div class="photos">
          ${photos.map(p => `<img src="${esc(p.photo_url)}" alt="" />`).join("")}
        </div>
      </div>`
    : "";

  const authorSigBlock = r.signature_url
    ? `<div class="sec">
        <div class="sec-h">작업책임자 서명 (${esc(r.user_name)})</div>
        <div class="sec-b"><img src="${esc(r.signature_url)}" alt="작업책임자 서명" class="sig-main" /></div>
      </div>`
    : "";

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>TBM 작성일지 ${esc(docNo)}</title>
  <style>
    *{box-sizing:border-box;font-family:'Malgun Gothic','맑은 고딕',sans-serif;}
    body{margin:12mm;color:#111;font-size:11px;}
    .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}
    h1{font-size:20px;text-align:center;flex:1;margin:0;letter-spacing:6px;}
    .doc{font-size:10px;border:1px solid #333;padding:4px 8px;line-height:1.4;}
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
    .c{text-align:center;font-weight:bold;}
    .pre{white-space:pre-wrap;line-height:1.6;}
    .muted{color:#999;}
    .rules{border:1px solid #333;border-top:none;margin:0;padding:6px 22px;list-style:none;}
    .rules li{margin:2px 0;}
    .sig-cell{padding:2px 4px;}
    .sig-mini{max-height:32px;max-width:120px;background:#fff;}
    .sig-main{max-height:80px;max-width:220px;background:#fff;border:1px solid #ccc;}
    .photos{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px;border:1px solid #333;border-top:none;}
    .photos img{width:100%;height:auto;object-fit:contain;border:1px solid #ddd;page-break-inside:avoid;}
    @media print{
      body{margin:8mm;}
      .sec,.photos img{page-break-inside:avoid;}
    }
  </style></head><body>
  <div class="top">
    <div class="doc">문서번호<br><b>${esc(docNo)}</b></div>
    <h1>T B M &nbsp; 작 성 일 지</h1>
    <table class="sign"><tr><td>작성</td><td>검토</td><td>승인</td></tr><tr><td></td><td></td><td></td></tr></table>
  </div>
  <table class="meta">
    <tr><td class="h">일시</td><td>${esc(fmtDt(r.created_at))}</td><td class="h">작성자</td><td>${esc(r.user_name)}</td></tr>
    <tr><td class="h">구분</td><td>${esc(modeLabel)}</td><td class="h">현장 / 호기</td><td>${esc(r.site_name)}${r.elevator_name ? ` / ${esc(r.elevator_name)}` : ""}</td></tr>
    ${partsRow}
    ${trappedRow}
  </table>
  ${workBlock}
  ${riskBlock}
  ${envBlock}
  ${heatRestsBlock}
  ${checklistBlock}
  ${rulesBlock}
  ${participantsBlock}
  ${photosBlock}
  ${authorSigBlock}
  <script>
    // 모든 이미지 로드 후 인쇄 (Supabase Storage 지연 대비)
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
      // 8초 안전장치
      setTimeout(tryPrint, 8000);
    });
  </script>
  </body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    alert("팝업이 차단되었습니다. PDF 출력을 위해 팝업을 허용해주세요.");
    return;
  }
  w.document.write(html);
  w.document.close();
}
