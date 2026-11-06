@echo off
rem Frameshift panel installer for Windows. Double-click it.
rem Installs for this user only, so no admin rights are needed.
setlocal
set "SRC=%~dp0com.harsh.panel"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.harsh.panel"

echo.
echo   Installing the Frameshift panel for Premiere Pro and After Effects
echo.

tasklist /FI "IMAGENAME eq Adobe Premiere Pro.exe" 2>nul | find /I "Adobe Premiere Pro.exe" >nul
if not errorlevel 1 (
  echo   Premiere Pro is open. Please quit Premiere Pro, then press any key.
  pause >nul
)
tasklist /FI "IMAGENAME eq AfterFX.exe" 2>nul | find /I "AfterFX.exe" >nul
if not errorlevel 1 (
  echo   After Effects is open. Please quit After Effects, then press any key.
  pause >nul
)
if not exist "%SRC%\CSXS\manifest.xml" (
  echo   Couldn't find the panel next to this installer.
  echo   Unzip the whole download first, then run this again.
  pause
  exit /b 1
)

if exist "%DEST%" rmdir /S /Q "%DEST%"
mkdir "%DEST%"
xcopy "%SRC%" "%DEST%" /E /I /Y /Q >nul

rem Allow unsigned panels in every Premiere version from 2022 on (CEP 9-12).
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

echo   Done. Open Premiere Pro or After Effects, then Window ^> Extensions ^> Frameshift.
echo   To update later, run the new installer the same way.
echo.
pause
