# restore.ps1 — 다른 PC에서 외장하드 꽂고 한 줄 실행
#
# 동작:
#   1. .\.claude-backup\  →  %USERPROFILE%\.claude\projects\H--DS-Material
#      로 robocopy /MIR (미러링). 이 PC의 Claude 대화·메모리를 외장하드 백업으로 덮어씀.
#   2. git pull --rebase --autostash origin HEAD — 원격 최신 가져오기.
#
# 사용:
#   .\restore.ps1
#
# 주의:
#   · 외장하드를 매번 같은 드라이브 문자(예: H:)로 마운트해야 폴더명이 일치합니다.
#     다른 문자로 잡히면 ".claude\projects\<드라이브>--DS-Material" 폴더명이 달라져
#     자동 복원이 안 됩니다.
#
# 실행 정책 막힐 때:
#   powershell -ExecutionPolicy Bypass -File .\restore.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== restore.ps1 시작 ===" -ForegroundColor Cyan
Write-Host "작업 폴더: $PSScriptRoot"
Write-Host ""

# ── 1) Claude 대화·메모리 복원 ──────────────────────────────────
Write-Host "[1/2] Claude 데이터 복원" -ForegroundColor Yellow

$claudeProj = Join-Path $env:USERPROFILE ".claude\projects\H--DS-Material"
$backupDir  = Join-Path $PSScriptRoot   ".claude-backup"

if (-not (Test-Path $backupDir)) {
    Write-Host "  ⚠ 백업 없음: $backupDir" -ForegroundColor Yellow
    Write-Host "    (외장하드에서 save.ps1을 먼저 실행하지 않았을 수 있음)" -ForegroundColor DarkGray
} else {
    if (-not (Test-Path $claudeProj)) {
        New-Item -ItemType Directory -Path $claudeProj -Force | Out-Null
    }
    $rcOut = robocopy $backupDir $claudeProj /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS 2>&1
    if ($LASTEXITCODE -ge 8) {
        Write-Host "  ✗ robocopy 실패 (exit $LASTEXITCODE)" -ForegroundColor Red
        $rcOut | Write-Host
        exit 1
    }
    Write-Host "  ✓ 복원 완료: $claudeProj" -ForegroundColor Green
}

Write-Host ""

# ── 2) Git 최신화 ───────────────────────────────────────────────
Write-Host "[2/2] Git 최신화 (pull)" -ForegroundColor Yellow

git fetch origin
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ⚠ fetch 실패 — 네트워크 확인" -ForegroundColor Yellow
} else {
    git pull --rebase --autostash origin HEAD
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ 최신 동기화" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ pull 실패 — 충돌 가능. 수동 처리 필요" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== 완료 ===" -ForegroundColor Cyan
Write-Host "이어서 작업하세요:  npm run dev" -ForegroundColor Gray
