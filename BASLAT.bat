@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

if not exist node_modules (
    echo İlk kurulum yapılıyor, lütfen bekleyin...
    call npm install
    if not exist .env copy .env.example .env
    call npx prisma migrate deploy
    call npx prisma generate
    call npm run seed
)

echo ======================================
echo   Mutlu Akaryakit Calisiyor
echo ======================================
echo.
echo   Tarayicida acin: http://localhost:3001
echo.
echo   Kapatmak icin bu pencereyi kapatin
echo ======================================
echo.

start http://localhost:3001
npm run dev
