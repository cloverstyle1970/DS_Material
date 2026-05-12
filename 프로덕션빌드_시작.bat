@echo off
chcp 65001 > nul
title DS 자재관리시스템 - 프로덕션

cd /d "%~dp0"

echo.
echo  [1/2] 빌드 중입니다. 잠시 기다려주세요...
echo.

npm run build
if %errorlevel% neq 0 (
  echo.
  echo  [오류] 빌드에 실패했습니다.
  pause
  exit /b 1
)

echo.
echo  [2/2] 서버를 시작합니다...
echo  주소: http://localhost:3000
echo  종료하려면 이 창을 닫으세요.
echo.

start "" http://localhost:3000
npm run start

pause
