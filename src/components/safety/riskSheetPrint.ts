import type { RiskCategory, HazardSurvey, HazardSurveyItem, HazardSurveyParticipant } from "@/lib/risk";

// 위험성평가표 인쇄(새 창) — KOSHA 결과서 양식 재현.
// items 는 위험성평가 입력(result/improvement/improve_done_date/manager)이 채워진 행.
type PrintItem = Pick<
  HazardSurveyItem,
  "gubun" | "hazard" | "accident_type" | "current_measure" | "result" | "improvement" | "improve_done_date" | "manager"
>;

type PrintParticipant = Pick<HazardSurveyParticipant, "user_name" | "signature_url">;

export function printRiskSheet(
  cat: RiskCategory,
  survey: HazardSurvey,
  items: PrintItem[],
  participants: PrintParticipant[] = []
) {
  const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const chk = (r: string | null, v: string) => (r === v ? "●" : "○");
  const body = items
    .map(
      (it) => `<tr>
      <td>${esc(it.gubun)}</td>
      <td class="l">${esc(it.hazard)}</td>
      <td>${esc(it.accident_type)}</td>
      <td class="l pre">${esc(it.current_measure)}</td>
      <td class="res">${chk(it.result, "적정")} 적정&nbsp;&nbsp;${chk(it.result, "보완")} 보완&nbsp;&nbsp;${chk(it.result, "해당없음")} 해당없음</td>
      <td class="l pre">${esc(it.improvement)}</td>
      <td>${esc(it.improve_done_date)}</td>
      <td>${esc(it.manager)}</td>
    </tr>`
    )
    .join("");

  // 평가 참가자 서명란 — 한 줄에 4명씩. 미서명자는 빈 칸으로 남겨 수기 서명이 가능하게 한다.
  const PER_ROW = 4;
  let signBlock = "";
  if (participants.length > 0) {
    const cells = participants.map(
      (p) => `<td>
        <div class="pname">${esc(p.user_name)}</div>
        <div class="pimg">${p.signature_url ? `<img src="${esc(p.signature_url)}" alt="">` : ""}</div>
      </td>`
    );
    const trs: string[] = [];
    for (let i = 0; i < cells.length; i += PER_ROW) {
      const chunk = cells.slice(i, i + PER_ROW);
      while (chunk.length < PER_ROW) chunk.push("<td></td>");
      trs.push(`<tr>${chunk.join("")}</tr>`);
    }
    signBlock = `<div class="psec">
      <div class="ptitle">평가 참가자 (${participants.length}명)</div>
      <table class="ptable">${trs.join("")}</table>
    </div>`;
  }

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>위험성평가표 ${esc(cat.doc_no)}</title>
  <style>
    *{box-sizing:border-box;font-family:'Malgun Gothic','맑은 고딕',sans-serif;}
    body{margin:16px;color:#111;}
    .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;}
    h1{font-size:20px;text-align:center;flex:1;margin:0;letter-spacing:8px;}
    .doc{font-size:12px;border:1px solid #333;padding:4px 8px;}
    .sign{border-collapse:collapse;font-size:11px;}
    .sign td{border:1px solid #333;padding:2px 10px;text-align:center;height:38px;}
    .meta{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px;}
    .meta td{border:1px solid #333;padding:4px 8px;}
    .meta .h{background:#f0f0f0;font-weight:bold;width:90px;}
    table.grid{width:100%;border-collapse:collapse;font-size:11px;}
    table.grid th,table.grid td{border:1px solid #333;padding:4px 6px;text-align:center;vertical-align:top;}
    table.grid th{background:#f0f0f0;}
    .l{text-align:left;}
    .pre{white-space:pre-wrap;}
    .res{white-space:nowrap;font-size:10px;}
    .psec{margin-top:10px;page-break-inside:avoid;}
    .ptitle{font-size:12px;font-weight:bold;margin-bottom:4px;}
    .ptable{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;}
    .ptable td{border:1px solid #333;padding:4px 6px;text-align:center;vertical-align:top;width:25%;}
    .pname{font-weight:bold;margin-bottom:2px;}
    .pimg{height:44px;display:flex;align-items:center;justify-content:center;}
    .pimg img{max-height:42px;max-width:100%;object-fit:contain;}
    @media print{body{margin:8mm;}}
  </style></head><body>
  <div class="top">
    <div class="doc">문서번호<br><b>${esc(cat.doc_no)}</b></div>
    <h1>위 험 성 평 가 표</h1>
    <table class="sign"><tr><td>작성</td><td>검토</td><td>승인</td></tr><tr><td></td><td></td><td></td></tr></table>
  </div>
  <table class="meta">
    <tr><td class="h">현장명</td><td>${esc(survey.site_name)}</td><td class="h">종류</td><td>${esc(survey.assess_type)}</td></tr>
    <tr><td class="h">대분류 공정</td><td>${esc(cat.name)}</td><td class="h">작성팀</td><td>${esc(survey.team)}</td></tr>
    <tr><td class="h">중분류 공정</td><td>${esc(cat.sub_process)}</td><td class="h">평가자</td><td>${esc(survey.assessor)}</td></tr>
    <tr><td class="h">작성일</td><td colspan="3">${esc(survey.survey_date)}</td></tr>
  </table>
  <table class="grid">
    <thead><tr>
      <th style="width:13%">구분</th><th>안전보건 유해·위험요인</th><th style="width:7%">재해형태</th>
      <th style="width:18%">현 안전조치</th><th style="width:15%">위험성 확인결과</th>
      <th style="width:18%">개선 대책</th><th style="width:8%">개선 완료일</th><th style="width:7%">담당자</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="8">항목 없음</td></tr>'}</tbody>
  </table>
  ${signBlock}
  <script>window.onload=function(){window.print();}</script>
  </body></html>`;

  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) {
    alert("팝업이 차단되었습니다. 인쇄를 위해 팝업을 허용해주세요.");
    return;
  }
  w.document.write(html);
  w.document.close();
}
