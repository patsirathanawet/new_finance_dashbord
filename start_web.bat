@echo off
REM === BMS Finance Dashboard launcher ===
REM   - production: backend PM2 + dist served at http://localhost:4000
REM   - PM2 auto-resurrects on boot via pm2-windows-startup
REM   - ถ้า PM2 ไม่ตอบ port 4000 (เช่น เพิ่ง install หรือ kill ไว้) → resurrect แล้วเปิด browser

setlocal
set URL=http://localhost:4000

REM ตรวจว่า port 4000 listen อยู่ไหม
netstat -ano | findstr /R /C:":4000.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [BMS] Backend ไม่ทำงาน — กำลังเรียก PM2 resurrect...
    call pm2 resurrect
    REM รอให้ PM2 boot ขึ้น
    timeout /t 3 /nobreak >nul
)

echo [BMS] เปิด %URL%
start "" "%URL%"
endlocal
