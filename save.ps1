# save.ps1 — 외장하드 떠나기 전 한 줄 실행
#
# 동작:
#   1. git add -A → 변경분 자동 커밋 → push origin master
#   2. Claude Code 프로젝트 데이터(대화 이력 + 메모리)를
#      %USERPROFILE%\.claude\projects\H--DS-Material  →  .\.claude-backup\
#      로 robocopy /MIR (미러링).
#
# 사용:
#   .\save.ps1                           # 자동 커밋 메시지
#   .\save.ps1 -Message "오늘 작업 요약"  # 메시지 지정
#
# 실행 정책 막힐 때:
#   powershell -ExecutionPolicy Bypass -File .\save.ps1

param([string]$Message = "")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== save.ps1 시작 ===" -ForegroundColor Cyan
Write-Host "작업 폴더: $PSScriptRoot"
Write-Host ""

# ── 1) Git: 변경 자동 커밋 + 푸시 ────────────────────────────────
Write-Host "[1/2] Git 커밋·푸시" -ForegroundColor Yellow

git add -A | Out-Null

git diff --cached --quiet
$hasStaged = ($LASTEXITCODE -ne 0)

if ($hasStaged) {
    if (-not $Message) {
        $Message = "wip: 자동 저장 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    }
    git commit -m $Message
    Write-Host "  ✓ 커밋: $Message" -ForegroundColor Green
} else {
    Write-Host "  · 커밋할 변경 없음" -ForegroundColor DarkGray
}

# 푸시할 게 있을 때만 push (offline 시 에러 회피)
$ahead = (git rev-list --count "@{u}..HEAD" 2>$null)
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ⚠ upstream 미설정 또는 네트워크 불가 — push 생략" -ForegroundColor Yellow
} elseif ([int]$ahead -gt 0) {
    git push origin HEAD
    Write-Host "  ✓ 푸시 완료 ($ahead 커밋)" -ForegroundColor Green
} else {
    Write-Host "  · 푸시할 커밋 없음" -ForegroundColor DarkGray
}

Write-Host ""

# ── 2) Claude 대화·메모리 백업 ──────────────────────────────────
Write-Host "[2/2] Claude 데이터 백업" -ForegroundColor Yellow

$claudeProj = Join-Path $env:USERPROFILE ".claude\projects\H--DS-Material"
$backupDir  = Join-Path $PSScriptRoot   ".claude-backup"

if (-not (Test-Path $claudeProj)) {
    Write-Host "  ⚠ Claude 폴더 없음: $claudeProj" -ForegroundColor Yellow
    Write-Host "    (이 PC에서 Claude Code로 작업한 적이 없을 수 있음)" -ForegroundColor DarkGray
} else {
    if (-not (Test-Path $backupDir)) {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }
    # /MIR: 미러, /R:1 /W:1: 재시도 최소화, /NFL /NDL: 파일/폴더 목록 출력 줄임
    $rcOut = robocopy $claudeProj $backupDir /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS 2>&1
    # robocopy 종료 코드 0~7은 정상
    if ($LASTEXITCODE -ge 8) {
        Write-Host "  ✗ robocopy 실패 (exit $LASTEXITCODE)" -ForegroundColor Red
        $rcOut | Write-Host
        exit 1
    }
    $size = (Get-ChildItem $backupDir -Recurse -ErrorAction SilentlyContinue |
             Measure-Object -Property Length -Sum).Sum
    $sizeMb = if ($size) { [math]::Round($size / 1MB, 2) } else { 0 }
    Write-Host "  ✓ 백업 완료: $backupDir  ($sizeMb MB)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== 완료 ===" -ForegroundColor Cyan
Write-Host "다른 PC에 외장하드 꽂고 .\restore.ps1 실행하세요." -ForegroundColor Gray
