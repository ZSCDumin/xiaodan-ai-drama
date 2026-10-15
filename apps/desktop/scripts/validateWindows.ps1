$ErrorActionPreference = 'Stop'
$output = Join-Path $PWD 'build/windowsPackages'
New-Item -ItemType Directory -Force $output | Out-Null
$installers = @(Get-ChildItem 'build/desktop/artifacts' -Filter '*-Setup.exe')
if ($installers.Count -ne 1) { throw '预期一个 Windows 安装包' }
$installer = $installers[0].FullName
$installDirectory = Join-Path $env:RUNNER_TEMP 'xiaodanInstalled'
$installation = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDirectory") -Wait -PassThru
if ($installation.ExitCode -ne 0) { throw "静默安装失败：$($installation.ExitCode)" }
Copy-Item $installer (Join-Path $output 'xiaodan-ai-drama-windows-x64-Setup.exe')
$resources = Join-Path $installDirectory 'app/Resources'
foreach ($relative in @('app/bin/launcher.exe', 'app/bin/bun.exe', 'app/Resources/app.ico', 'app/Resources/app/startupLauncher.exe', 'UninstallNSIS.exe')) {
  if (!(Test-Path (Join-Path $installDirectory $relative))) { throw "缺少安装文件：$relative" }
}
$version = Get-Content (Join-Path $resources 'version.json') -Raw | ConvertFrom-Json
if ($version.identifier -ne 'local.xiaodan.aidrama.desktop') { throw '应用标识错误' }
$registry = Get-ItemProperty "HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/$($version.identifier).stable"
if ($registry.DisplayName -ne '小丹 AI短剧') { throw '系统安装名称错误' }
$env:TOONFLOW_DATA_DIR = Join-Path $env:RUNNER_TEMP 'xiaodanValidationData'
$bin = Join-Path $installDirectory 'app/bin'
$process = Start-Process -FilePath (Join-Path $bin 'launcher.exe') -WorkingDirectory $bin -PassThru -RedirectStandardOutput (Join-Path $output 'startup.stdout.log') -RedirectStandardError (Join-Path $output 'startup.stderr.log')
try {
  $deadline = (Get-Date).AddSeconds(150)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    $runtimeFile = Join-Path $resources 'desktopRuntime.json'
    if (Test-Path $runtimeFile) {
      try {
        $runtime = Get-Content $runtimeFile -Raw | ConvertFrom-Json
        Get-Process -Id $runtime.pid -ErrorAction Stop | Out-Null
        $origin = "http://127.0.0.1:$($runtime.port)"
        $headers = @{ 'x-toonflow-desktop' = '1'; 'x-toonflow-workspace' = '1'; Origin = $origin; Referer = "$origin/" }
        $settings = Invoke-RestMethod "$origin/api/settings/get" -Headers $headers -TimeoutSec 5
        $page = Invoke-WebRequest "$origin/" -TimeoutSec 5
        if ($settings.code -eq 200 -and $page.Content.Contains('<title>小丹 AI短剧</title>')) { $ready = $true; break }
      } catch { }
    }
    Start-Sleep -Seconds 2
  }
  if (!$ready) {
    Get-Content (Join-Path $output 'startup.stdout.log') -ErrorAction SilentlyContinue
    Get-ChildItem $env:TOONFLOW_DATA_DIR -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length
    Get-Content (Join-Path $output 'startup.stderr.log') -ErrorAction SilentlyContinue
    throw '应用启动或内置 HTTP 服务验证失败'
  }
  @('静默安装：通过', '应用名称和标识：通过', '启动文件与图标：通过', '应用进程：存活（标准启动器）', '首页与设置接口：通过') | Set-Content (Join-Path $output 'validation.txt') -Encoding utf8
} finally {
  & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
  $global:LASTEXITCODE = 0
}
$destination = Join-Path $output 'xiaodan-ai-drama-windows-x64-Setup.exe'
Copy-Item $installer $destination
$hash = (Get-FileHash $destination -Algorithm SHA256).Hash.ToLower()
"$hash  xiaodan-ai-drama-windows-x64-Setup.exe" | Set-Content (Join-Path $output 'sha256.txt') -Encoding utf8
