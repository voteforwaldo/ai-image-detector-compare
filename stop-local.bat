@echo off
cd /d "%~dp0"
echo Stopping server on port 3000...

powershell -NoProfile -Command ^
  "$p = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique; if (-not $p) { Write-Host 'No server on port 3000.'; exit 0 }; foreach ($id in $p) { if ($id) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Host ('Stopped PID ' + $id) } }"

echo Done.
pause
