# server.ps1 — раздача папки проекта по локальной сети средствами Windows.
# Запасной вариант: используется, если на компьютере нет ни Python, ни Node.
# HttpListener умеет слушать сеть только с правами администратора, поэтому
# server.cmd при этом варианте просит повышение прав.
param([int]$Port = 8080)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")

try { $listener.Start() }
catch {
    Write-Host "Не удалось занять порт $Port. Возможно, он уже используется." -ForegroundColor Red
    Write-Host "Запустите server.cmd ещё раз и укажите другой порт, например: server.cmd 8081"
    Read-Host "Enter — выход"
    exit 1
}

$types = @{
    '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8';  '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml';  '.png' = 'image/png';  '.jpg' = 'image/jpeg'
    '.ico'  = 'image/x-icon';   '.woff2' = 'font/woff2'
}

Write-Host "Сервер работает. Ctrl+C — остановить." -ForegroundColor Green
while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
    $path = Join-Path $root $rel

    # не выпускаем за пределы папки проекта
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
