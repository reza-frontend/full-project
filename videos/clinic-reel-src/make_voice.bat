@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
if "%GEMINI_API_KEY%"=="" set /p GEMINI_API_KEY=Gemini API key: 
python voice.py || goto :err
ffmpeg -y -i clinic-receptionist-reel.mp4 -i voice.wav -filter_complex "[1:a]aresample=44100,volume=1.6[v];[0:a]volume=0.35[m];[m][v]amix=inputs=2:duration=first:normalize=0[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k final.mp4 || goto :err
echo.
echo Done: final.mp4
pause
exit /b 0
:err
echo.
echo ERROR - see messages above
pause
exit /b 1
