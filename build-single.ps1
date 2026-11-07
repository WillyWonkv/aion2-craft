$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$template = [IO.File]::ReadAllText((Join-Path $root 'local-server-template.ps1'))
$html = [IO.File]::ReadAllText((Join-Path $root 'site/public/index.html'))
$appjs = [IO.File]::ReadAllText((Join-Path $root 'site/public/app.js'))
$modeljs = [IO.File]::ReadAllText((Join-Path $root 'site/public/cost-model.js'))
$graph = [IO.File]::ReadAllText((Join-Path $root 'site/public/recipes-global.json'))
if ($html -match "(?m)^'@$" -or $appjs -match "(?m)^'@$" -or $modeljs -match "(?m)^'@$" -or $graph -match "(?m)^'@$") { throw 'Il contenuto termina un here-string.' }
$body = $template.Replace('__HTML__', $html).Replace('__APPJS__', $appjs).Replace('__COST_MODEL__', $modeljs).Replace('__GLOBAL_GRAPH__', $graph)
$preamble = @'
@echo off
setlocal
set "AION2_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$raw=[IO.File]::ReadAllText($env:AION2_SELF); $pos=$raw.LastIndexOf('# POWERSHELL_START'); if($pos -lt 0){throw 'Avvio non valido'}; & ([scriptblock]::Create($raw.Substring($pos)))"
if errorlevel 1 pause
exit /b
'@
$destination = Join-Path $root 'Aion2-Craft.cmd'
$encoding = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($destination, $preamble + "`r`n" + $body, $encoding)
Write-Output $destination
