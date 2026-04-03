@echo off
REM ═══════════════════════════════════════════════════════
REM  Trakend OS — Build Installer ISO (Windows)
REM ═══════════════════════════════════════════════════════
REM
REM  This script uses Docker to build a bootable ISO.
REM  The ISO can then be flashed to a USB drive with Rufus.
REM
REM  Prerequisites:
REM    - Docker Desktop running
REM    - Run from the trakend-os project root directory
REM
REM  Usage:
REM    cd trakend-os
REM    installer\build.bat
REM
REM  Output: installer\output\trakend-os-1.0.000-installer.iso
REM ═══════════════════════════════════════════════════════

echo.
echo   ══════════════════════════════════════════════
echo     TRAKEND OS — ISO Installer Builder
echo   ══════════════════════════════════════════════
echo.

REM Check Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] Docker is not running!
    echo   Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

echo   [1/3] Building Docker image for ISO creation...
echo         This downloads Ubuntu packages — first run takes 10-20 minutes.
echo.

docker build --no-cache -t trakend-iso-builder -f installer/Dockerfile .
if errorlevel 1 (
    echo.
    echo   [ERROR] Docker build failed!
    echo   Check the output above for errors.
    pause
    exit /b 1
)

echo.
echo   [2/3] Creating output directory...
if not exist "installer\output" mkdir installer\output

echo.
echo   [3/3] Building Trakend OS installer ISO (OFFLINE mode)...
echo         This takes 20-40 minutes (downloads ALL packages for offline install).
echo.

docker run --rm --privileged -v "%cd%\installer\output:/output" trakend-iso-builder
if errorlevel 1 (
    echo.
    echo   [ERROR] ISO build failed!
    echo   Check the output above for errors.
    pause
    exit /b 1
)

echo.
echo   ══════════════════════════════════════════════════════════
echo.
echo     SUCCESS! Your installer ISO is ready:
echo.
echo     installer\output\trakend-os-1.0.000-installer.iso
echo.
echo     Next steps:
echo       1. Download Rufus: https://rufus.ie
echo       2. Open Rufus, select the ISO file above
echo       3. Select your USB drive (8GB minimum)
echo       4. Click START
echo       5. Plug USB into your server and boot from it
echo.
echo   ══════════════════════════════════════════════════════════
echo.
pause
