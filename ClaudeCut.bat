@echo off
setlocal EnableExtensions
title ClaudeCut
rem ---------------------------------------------------------------
rem  ClaudeCut launcher
rem   - Double-click: asks which project folder to open
rem   - Drag a project folder onto this file: opens that folder
rem   - From a terminal:  ClaudeCut.bat "D:\my-project" --budget 2
rem ---------------------------------------------------------------

set "CLI=%~dp0packages\claudecut-cli\bin\claudecut.js"
set "BUDGET="

where node >nul 2>nul
if errorlevel 1 (
  echo [ClaudeCut] Node.js is not installed. Get it from https://nodejs.org
  pause
  exit /b 1
)
if not exist "%CLI%" (
  echo [ClaudeCut] Cannot find "%CLI%"
  pause
  exit /b 1
)

set "PROJECT=%~1"
if defined PROJECT (
  shift
) else (
  echo.
  echo  ClaudeCut - run Claude Code with a live cost dashboard
  echo.
  set /p "PROJECT=Project folder (drag it here, or press Enter for %CD%): "
)
if not defined PROJECT set "PROJECT=%CD%"
set "PROJECT=%PROJECT:"=%"

if not exist "%PROJECT%\" (
  echo [ClaudeCut] Folder not found: "%PROJECT%"
  pause
  exit /b 1
)

rem Collect the remaining arguments (after the folder).
set "ARGS="
:collect
if "%~1"=="" goto run
set ARGS=%ARGS% %1
shift
goto collect

:run
if not defined ARGS (
  set "BUDGET="
  set /p "BUDGET=Budget in USD for this session (Enter = no limit): "
)
if defined BUDGET set ARGS=--budget %BUDGET%

cd /d "%PROJECT%"
node "%CLI%" %ARGS%
echo.
pause
