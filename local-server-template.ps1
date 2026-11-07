# POWERSHELL_START
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$html = @'
__HTML__
'@
$appjs = @'
__APPJS__
'@
$modeljs = @'
__COST_MODEL__
'@
$graphJson = @'
__GLOBAL_GRAPH__
'@
$utf8 = New-Object System.Text.UTF8Encoding($false)
$cache = @{}

function Send-Http($stream, [int]$status, [string]$mime, [string]$body) {
  $reason = if ($status -eq 200) { 'OK' } elseif ($status -eq 400) { 'Bad Request' } elseif ($status -eq 404) { 'Not Found' } else { 'Bad Gateway' }
  $data = $utf8.GetBytes($body)
  $header = "HTTP/1.1 $status $reason`r`nContent-Type: $mime`r`nContent-Length: $($data.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $head = [Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($head, 0, $head.Length)
  $stream.Write($data, 0, $data.Length)
  $stream.Flush()
}

function Read-Json($uri) {
  $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 40 -Headers @{ 'User-Agent' = 'Mozilla/5.0 (Aion2-Craft-Local)' ; 'Accept' = 'application/json' }
  return $response.Content
}

function Api-Response($target) {
  if ($target -eq '/api/servers') {
    if ($cache.ContainsKey('servers') -and $cache.servers.expires -gt [DateTime]::UtcNow) { return $cache.servers.body }
    $body = Read-Json 'https://aion2.exchange/api/servers'
    $cache.servers = @{ body = $body; expires = [DateTime]::UtcNow.AddHours(1) }
    return $body
  }
  if ($target -eq '/api/graph') {
    return $graphJson
  }
  if ($target -match '^/api/prices\?') {
    $match = [regex]::Match($target, '(?:\?|&)server=(\d{5})(?:&|$)')
    if (-not $match.Success) { throw 'Server non valido' }
    $serverId = $match.Groups[1].Value
    $items = New-Object System.Collections.ArrayList
    $offset = 0
    do {
      $uri = "https://aion2.exchange/api/items?sort=name&order=asc&window=24h&limit=200&offset=$offset&server=$serverId"
      $page = Read-Json $uri | ConvertFrom-Json
      if ($null -eq $page.items -or [int]$page.total -gt 10000) { throw 'Risposta del mercato inattesa' }
      foreach ($item in $page.items) { [void]$items.Add($item) }
      $offset += 200
    } while ($offset -lt [int]$page.total)
    return @{ server = [int]$serverId; items = @($items.ToArray()); retrieved_at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 20 -Compress
  }
  return $null
}

$listener = $null
foreach ($candidate in 4173..4183) {
  try {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
    $listener.Start()
    $port = $candidate
    break
  } catch { $listener = $null }
}
if ($null -eq $listener) { throw 'Nessuna porta locale disponibile tra 4173 e 4183.' }
$address = "http://127.0.0.1:$port/"
Write-Host "Aion 2 Craft aperto su $address" -ForegroundColor Cyan
Write-Host 'Lascia aperta questa finestra mentre usi la pagina. Premi Ctrl+C per chiudere.'
try { Start-Process $address } catch { Write-Host "Apri manualmente $address nel browser." -ForegroundColor Yellow }

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    # Browsers may open speculative connections without sending a request.
    $client.ReceiveTimeout = 2000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
    $first = $null
    try { $first = $reader.ReadLine() } catch { continue }
    if (-not $first) { continue }
    $client.ReceiveTimeout = 5000
    try { do { $line = $reader.ReadLine() } while ($line -ne $null -and $line -ne '') } catch { continue }
    if ($null -eq $line) { continue }
    $parts = $first.Split(' ')
    if ($parts.Length -lt 2 -or $parts[0] -ne 'GET') { Send-Http $stream 400 'text/plain; charset=utf-8' 'Richiesta non valida'; continue }
    $target = $parts[1]
    if ($target -eq '/' -or $target -eq '/index.html') { Send-Http $stream 200 'text/html; charset=utf-8' $html; continue }
    if ($target -eq '/app.js') { Send-Http $stream 200 'text/javascript; charset=utf-8' $appjs; continue }
    if ($target -eq '/cost-model.js') { Send-Http $stream 200 'text/javascript; charset=utf-8' $modeljs; continue }
    try {
      $body = Api-Response $target
      if ($null -eq $body) { Send-Http $stream 404 'application/json; charset=utf-8' '{"error":"Pagina non trovata"}' }
      else { Send-Http $stream 200 'application/json; charset=utf-8' $body }
    } catch {
      $message = @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
      Send-Http $stream 502 'application/json; charset=utf-8' $message
    }
  } catch {
    Write-Host ('Errore nella richiesta ' + $first + ': ' + $_.Exception.Message) -ForegroundColor Yellow
  } finally {
    $client.Close()
  }
}
