# Rebuild and restart this project's production server on port 3001.
# Only ever stops a process whose command line is this project's `next start`.
$here = Split-Path -Parent $PSScriptRoot
$c = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
  if ($p.CommandLine -like '*space-apps-2026*next*start*') { Stop-Process -Id $p.ProcessId -Force -Confirm:$false; Start-Sleep -Seconds 1 }
  else { Write-Output "Port 3001 is held by another program: $($p.CommandLine)"; exit 1 }
}
Push-Location $here
npm run build 2>&1 | Select-String -Pattern "error|Failed|Compiled|Finished TypeScript|^src"
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx next start -p 3001 > server.log 2>&1" -WorkingDirectory $here -WindowStyle Hidden
Pop-Location
for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest -Uri http://localhost:3001/ -UseBasicParsing -TimeoutSec 3 | Out-Null; Write-Output "ready on http://localhost:3001"; exit 0 } catch { Start-Sleep -Seconds 1 } }
Write-Output "server did not come up"; exit 1
