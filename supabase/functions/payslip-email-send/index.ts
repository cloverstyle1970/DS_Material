// Supabase Edge Function: payslip-email-send
// POST body { to, emp_name, year, month, pdfBase64, filename }
//   - Gmail SMTP 로 PDF 첨부 급여명세서 발송
//   - 환경변수: GMAIL_USER (발신 Gmail 주소), GMAIL_APP_PASSWORD (앱 비밀번호)
//     ※ Gmail 앱 비밀번호: Google 계정 → 보안 → 2단계 인증 활성화 후 → 앱 비밀번호 생성
//
// 배포: supabase functions deploy payslip-email-send
// 환경변수 설정: supabase secrets set GMAIL_USER=xxx GMAIL_APP_PASSWORD=xxx

import nodemailer from "npm:nodemailer@6";
import { Buffer } from "node:buffer";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json({ error: "method not allowed" }, { status: 405 });

  // @ts-expect-error Deno
  const GMAIL_USER     = (Deno.env.get("GMAIL_USER")         ?? "").trim();
  // @ts-expect-error Deno
  const GMAIL_APP_PASS = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").trim();

  if (!GMAIL_USER || !GMAIL_APP_PASS) {
    return json({ error: "GMAIL_USER / GMAIL_APP_PASSWORD 환경변수 미설정" }, { status: 500 });
  }

  let body: {
    to: string;
    emp_name: string;
    year: number;
    month: number;
    pdfBase64: string;
    filename: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON 파싱 실패" }, { status: 400 });
  }

  const { to, emp_name, year, month, pdfBase64, filename } = body;
  if (!to || !pdfBase64 || !filename) {
    return json({ error: "to, pdfBase64, filename 필수" }, { status: 400 });
  }

  const pdfBuffer = Buffer.from(pdfBase64, "base64");

  const transporter = nodemailer.createTransport({
    host:   "smtp.gmail.com",
    port:   587,
    secure: false,
    auth:   { user: GMAIL_USER, pass: GMAIL_APP_PASS },
  });

  try {
    await transporter.sendMail({
      from:    `"대솔이엘" <${GMAIL_USER}>`,
      to,
      subject: `[대솔이엘] ${year}년 ${String(month).padStart(2, "0")}월 급여명세서`,
      html: `
        <p>${emp_name} 님,</p>
        <p>${year}년 ${String(month).padStart(2, "0")}월 급여명세서를 첨부해 드립니다.</p>
        <p>문의사항은 경리 담당자에게 연락 주세요.</p>
        <br/>
        <p style="color:#888;font-size:12px;">대솔이엘 경리팀</p>
      `,
      attachments: [
        {
          filename,
          content:     pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[payslip-email-send] SMTP error:", msg);
    return json({ error: `이메일 발송 실패: ${msg}` }, { status: 500 });
  }

  return json({ ok: true });
});
