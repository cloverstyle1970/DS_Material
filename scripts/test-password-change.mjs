// 비밀번호 변경 기능 검증 스크립트
// 사용: node scripts/test-password-change.mjs <username> <currentPw>
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const username = process.argv[2] || "황진한";
const currentPw = process.argv[3] || "1234";

const browser = await chromium.launch({ headless: false, slowMo: 300 });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// 네트워크 요청 모니터링 — accounts PATCH(password 포함 여부 확인)
const accountsWrites = [];
page.on("request", req => {
  if (req.url().includes("/accounts") && ["PATCH","POST","PUT"].includes(req.method())) {
    try {
      const body = req.postDataJSON?.() ?? {};
      accountsWrites.push({ method: req.method(), url: req.url(), hasPassword: "password" in body, body });
    } catch { accountsWrites.push({ method: req.method(), url: req.url(), raw: req.postData() }); }
  }
});

console.log(`\n▶ 1. 로그인 (${username})`);
await page.goto(`${BASE}/login`);
await page.waitForSelector("input[type=text], input[placeholder]", { timeout: 10000 });
await page.screenshot({ path: "test-pw-01-login.png" });

// 사용자명 + 비밀번호 입력
const inputs = await page.locator("input").all();
await inputs[0].fill(username);
await inputs[1].fill(currentPw);
await page.screenshot({ path: "test-pw-02-filled.png" });
await inputs[1].press("Enter");

// 로그인 결과 대기
try {
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 20000 });
  console.log("  ✅ 로그인 성공:", page.url());
} catch {
  // 타임아웃이지만 이미 로그인 완료된 경우 처리
  if (!page.url().includes("/login")) {
    console.log("  ✅ 로그인 성공(지연):", page.url());
  } else {
    const errText = await page.locator("text=/오류|잘못|올바르지/").textContent().catch(() => "");
    console.log("  ❌ 로그인 실패:", errText || "타임아웃");
    await page.screenshot({ path: "test-pw-fail-login.png" });
    await browser.close();
    process.exit(1);
  }
}

console.log("\n▶ 2. 개인정보수정(/data/profile) 이동");
await page.goto(`${BASE}/data/profile`);
await page.waitForTimeout(1500);

// AdminShell 탭 시스템: goto로 열린 탭이 바로 포커스되지 않을 수 있음
// "개인정보수정" 탭 버튼을 클릭해 명시적으로 활성화
const profileTab = page.locator("[role=tab], button").filter({ hasText: /개인정보수정/ });
if (await profileTab.count() > 0) {
  await profileTab.first().click();
  await page.waitForTimeout(1000);
  console.log("  ✅ '개인정보수정' 탭 활성화");
} else {
  // 사이드바 링크 클릭으로 탭 열기
  const sidebarLink = page.locator("a[href='/data/profile'], button").filter({ hasText: /개인정보수정/ });
  if (await sidebarLink.count() > 0) {
    await sidebarLink.first().click();
    await page.waitForTimeout(1500);
    console.log("  ✅ 사이드바에서 개인정보수정 열기");
  }
}
await page.waitForTimeout(2000);
await page.screenshot({ path: "test-pw-03-profile.png" });

// 비밀번호 변경 섹션은 '기본정보' 탭(기본 선택) 안에 있음
// 로그인 비밀번호 변경 섹션 확인
const pwSection = page.locator("text=로그인 비밀번호 변경");
const hasPwSection = await pwSection.count() > 0;
console.log("  비밀번호 변경 섹션:", hasPwSection ? "✅ 발견" : "❌ 없음");

// 비밀번호 입력 필드 탐색 (현재/새/확인)
const pwInputs = await page.locator("input[type=password]").all();
console.log(`  password 타입 input 수: ${pwInputs.length}`);

if (pwInputs.length < 3) {
  console.log("  ⚠️  비밀번호 변경 폼을 찾지 못함 (입력 수:", pwInputs.length, ")");
  await page.screenshot({ path: "test-pw-04-debug.png" });
  await browser.close();
  process.exit(1);
}
await page.screenshot({ path: "test-pw-04-pw-section.png" });

// 비밀번호 변경 전용 버튼 (type=button, 텍스트 "비밀번호 변경")
const changeBtn = page.locator("button[type=button]").filter({ hasText: "비밀번호 변경" });
const changeBtnCount = await changeBtn.count();
console.log("  '비밀번호 변경' 버튼 수:", changeBtnCount);
if (changeBtnCount === 0) {
  console.log("  ⚠️  '비밀번호 변경' 버튼을 찾지 못함");
  await browser.close();
  process.exit(1);
}

// ─── 테스트 A: 틀린 현재 비밀번호 ───
console.log("\n▶ 3. [테스트 A] 현재 비밀번호 틀린 경우");
accountsWrites.length = 0;
await pwInputs[0].fill("wrongpassword999!");
await pwInputs[1].fill("newpass123");
await pwInputs[2].fill("newpass123");

await changeBtn.click();
await page.waitForTimeout(4000);  // Supabase Auth signInWithPassword 응답 대기
await page.screenshot({ path: "test-pw-05-wrong-current.png" });

// 비밀번호 관련 오류 텍스트 탐색 (한글 정규식 대신 getByText 사용)
const errEl = page.getByText("현재 비밀번호가 올바르지 않습니다.");
const hasErrMsg = await errEl.isVisible().catch(() => false);
const errMsg = hasErrMsg ? await errEl.textContent().catch(() => "") : "";
console.log("  오류 메시지:", errMsg || "(없음)");
console.log("  accounts 쓰기 요청 수:", accountsWrites.length,
  accountsWrites.some(r => r.hasPassword) ? "⚠️ password 포함됨!" : "(password 없음 ✅)");

if (hasErrMsg) {
  console.log("  ✅ Supabase Auth 검증 작동 — 틀린 비밀번호 거부 확인");
} else {
  // 스크린샷으로 상태 확인 보완
  const pwStatusDiv = page.locator(".bg-red-50, .bg-red-900\\/30");
  const pwStatusText = await pwStatusDiv.textContent().catch(() => "");
  console.log("  ℹ️  빨간 박스 내용:", pwStatusText || "(없음)");
  if (pwStatusText.includes("비밀번호") || pwStatusText.includes("오류")) {
    console.log("  ✅ Supabase Auth 검증 작동 (getByText 탐색 타이밍 이슈)");
  } else {
    console.log("  ❌ 예상 오류 메시지 없음");
  }
}

// ─── 테스트 B: 새 비밀번호 불일치 (클라이언트 검증) ───
console.log("\n▶ 4. [테스트 B] 새 비밀번호 불일치");
accountsWrites.length = 0;
await pwInputs[0].fill(currentPw);
await pwInputs[1].fill("newpass123");
await pwInputs[2].fill("different456");
await changeBtn.click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "test-pw-06-mismatch.png" });

const mismatchMsg = await page.locator("text=/일치|불일치/").textContent().catch(() => "");
console.log("  오류 메시지:", mismatchMsg || "(없음)");
console.log("  accounts 쓰기:", accountsWrites.length,
  accountsWrites.some(r => r.hasPassword) ? "⚠️ password 포함됨!" : "(없음 ✅)");

// ─── 최종 요약 ───
console.log("\n─────────────────────────────");
console.log("accounts.password 쓰기 전체 감지 결과:");
if (accountsWrites.length === 0) {
  console.log("  ✅ accounts 테이블에 password 컬럼 쓰기 없음");
} else {
  accountsWrites.forEach(r => console.log("  요청:", JSON.stringify(r)));
}

await browser.close();
