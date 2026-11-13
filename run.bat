@echo off
cd /d "%~dp0"
echo ===============================================================================
echo Starting KBS Industrial Fault Diagnosis & Hybrid AI Server...
echo ===============================================================================

if exist "C:\Users\alhma\anaconda3\python.exe" (
    "C:\Users\alhma\anaconda3\python.exe" app.py
) else (
    python app.py
)
pause
