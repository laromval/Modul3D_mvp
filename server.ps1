param(
    [int]$Port = 8080,
    [switch]$Native
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Show-Banner {
    $ip = $null
    try {
        # Берём адрес адаптера, у которого реально есть шлюз по умолчанию -
        # это отличает настоящую сеть (Wi-Fi/Ethernet) от виртуальных
        # адаптеров (Hyper-V vEthernet, WSL, VPN), у которых шлюза нет.
        $ip = Get-NetIPConfiguration -ErrorAction Stop |
              Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
              Select-Object -First 1 -ExpandProperty IPv4Address |
              Select-Object -First 1 -ExpandProperty IPAddress
    } catch {}
    if (-not $ip) {
        try {
            $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
                  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
                  Select-Object -First 1 -ExpandProperty IPAddress
        } catch {}
    }

    Write-Host ""
    Write-Host "  Modul3D - доступ с других устройств по локальной сети" -ForegroundColor Cyan
    Write-Host "  ---------------------------------------------------"
    Write-Host ""
    Write-Host "  На этом компьютере:  http://localhost:$Port/"
    if ($ip) { Write-Host "  С телефона/планшета: http://${ip}:$Port/" }
    Write-Host ""
    Write-Host "  Устройство должно быть в той же сети Wi-Fi."
    Write-Host "  При первом запуске Windows спросит разрешение сети - разрешите для ЧАСТНОЙ сети."
    Write-Host "  Закрыть это окно = выключить сервер."
    Write-Host ""
}

function Test-Runs([string]$exe, [string[]]$testArgs) {
    try {
        & $exe @testArgs *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Start-NativeListener {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://+:$Port/")

    try { $listener.Start() }
    catch {
        Write-Host "Не удалось занять порт $Port. Возможно, он уже используется." -ForegroundColor Red
        Write-Host "Запустите server.cmd ещё раз и укажите другой порт, например: server.cmd 8081"
        Read-Host "Enter - выход"
        exit 1
    }

    $types = @{
        '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
        '.js'   = 'application/javascript; charset=utf-8'
        '.css'  = 'text/css; charset=utf-8';  '.json' = 'application/json; charset=utf-8'
        '.svg'  = 'image/svg+xml';  '.png' = 'image/png';  '.jpg' = 'image/jpeg'
        '.ico'  = 'image/x-icon';   '.woff2' = 'font/woff2'
    }

    Write-Host "Сервер работает. Ctrl+C - остановить." -ForegroundColor Green
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
        $path = Join-Path $root $rel

        $full = [System.IO.Path]::GetFullPath($path)
        if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root))) {
            $ctx.Response.StatusCode = 403; $ctx.Response.Close(); continue
        }

        if (Test-Path $full -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($full)
            $ext = [System.IO.Path]::GetExtension($full).ToLower()
            $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
        }
        $ctx.Response.Close()
    }
}

if ($Native) {
    Show-Banner
    Start-NativeListener
    exit
}

Show-Banner

if ((Get-Command py -ErrorAction SilentlyContinue) -and (Test-Runs 'py' @('-3', '-c', '1'))) {
    Write-Host "  Раздаю папку через Python..."
    & py -3 -m http.server $Port
    Write-Host ""
    Write-Host "  Сервер остановлен."
    Read-Host "Enter - выход"
    exit
}

if ((Get-Command python -ErrorAction SilentlyContinue) -and (Test-Runs 'python' @('-c', '1'))) {
    Write-Host "  Раздаю папку через Python..."
    & python -m http.server $Port
    Write-Host ""
    Write-Host "  Сервер остановлен."
    Read-Host "Enter - выход"
    exit
}

if (Get-Command npx -ErrorAction SilentlyContinue) {
    Write-Host "  Раздаю папку через Node..."
    & npx --yes http-server -p $Port
    Write-Host ""
    Write-Host "  Сервер остановлен."
    Read-Host "Enter - выход"
    exit
}

Write-Host "  Ни Python, ни Node не найдены - запускаю встроенный сервер Windows."
Write-Host "  Потребуются права администратора: Windows разрешает слушать сеть только так."

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($MyInvocation.MyCommand.Path)`"",
        '-Port', $Port, '-Native'
    )
    exit
}

Start-NativeListener
