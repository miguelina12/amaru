# Arranca el cerebro de Faro en este ordenador y lo publica con un túnel rápido de Cloudflare.
#   powershell -ExecutionPolicy Bypass -File server\arrancar.ps1
# 1. Comprueba que Ollama esté en marcha y tenga el modelo.
# 2. Arranca server\faro-server.mjs (solo en 127.0.0.1).
# 3. Abre el túnel (https://….trycloudflare.com). La dirección cambia en cada arranque, así que la escribe en
#    server.json y la sube a la rama: GitHub Pages la publica y la app la lee de ahí.
# Ctrl+C lo para todo.

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$model = if ($env:FARO_MODEL) { $env:FARO_MODEL } else { 'gemma3:4b' }
$ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { $cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
$logs = Join-Path $env:LOCALAPPDATA 'Faro'
New-Item -ItemType Directory -Force $logs | Out-Null

# 1. Ollama
try { Invoke-RestMethod http://127.0.0.1:11434/api/tags -TimeoutSec 3 | Out-Null }
catch {
  Write-Host 'Arrancando Ollama…'
  Start-Process $ollama -ArgumentList 'serve' -WindowStyle Hidden
  Start-Sleep 4
}
$tags = Invoke-RestMethod http://127.0.0.1:11434/api/tags
if (-not ($tags.models | Where-Object { $_.name -eq $model })) { throw "Falta el modelo $model. Ejecuta: ollama pull $model" }

# 2. Servidor de Faro
$node = Start-Process node -ArgumentList "`"$repo\server\faro-server.mjs`"" -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput "$logs\servidor.log" -RedirectStandardError "$logs\servidor-error.log"
Start-Sleep 2
Invoke-RestMethod http://127.0.0.1:8787/v1/health | Out-Null
Write-Host 'Servidor de Faro en marcha (127.0.0.1:8787).'

# 3. Túnel
$tlog = "$logs\tunel.log"
Remove-Item $tlog -ErrorAction SilentlyContinue
$tunnel = Start-Process $cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8787' `
  -PassThru -WindowStyle Hidden -RedirectStandardError $tlog -RedirectStandardOutput "$logs\tunel-out.log"
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep 1
  if (Test-Path $tlog) { $m = Select-String -Path $tlog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } }
}
if (-not $url) { Stop-Process -Id $node.Id, $tunnel.Id -Force; throw "El túnel no arrancó. Mira $tlog" }
Write-Host "Publicado en $url"

# Publicar la dirección para la app (solo si ha cambiado)
$json = Join-Path $repo 'server.json'
$old = if (Test-Path $json) { (Get-Content $json -Raw | ConvertFrom-Json).url } else { '' }
if ($old -ne $url) {
  $obj = [ordered]@{ url = $url; modelo = $model; actualizado = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
  [IO.File]::WriteAllText($json, ($obj | ConvertTo-Json) + "`n", (New-Object Text.UTF8Encoding $false))
  git -C $repo add server.json
  git -C $repo commit -m "Nueva dirección del cerebro de Faro" --quiet
  git -C $repo pull --rebase --quiet
  git -C $repo push --quiet
  Write-Host 'Dirección subida a GitHub; la app la verá en 1-2 minutos (cuando GitHub Pages publique).'
}

Write-Host 'Faro está escuchando. Deja este ordenador encendido y sin suspender. Ctrl+C para parar.'
try {
  while (-not $node.HasExited -and -not $tunnel.HasExited) { Start-Sleep 5 }
  Write-Host 'Algo se ha parado (servidor o túnel). Mira los registros en' $logs
} finally {
  foreach ($p in $node, $tunnel) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force } }
}
