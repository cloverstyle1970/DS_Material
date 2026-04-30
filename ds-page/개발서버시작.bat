@echo off
chcp 65001 > nul
title DS 자재관리시스템 - 개발서버

cd /d "%~dp0"

echo.
echo  DS 자재관리시스템 개발 서버를 시작합니다...
echo  주소: http://localhost:3000
echo  종료하려면 이 창을 닫으세요.
echo.

start "" http://localhost:3000
npm run dev

pause
