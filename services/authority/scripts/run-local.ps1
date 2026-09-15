# 本地启动授权中心：从 ..\docker\.env 读取数据库口令，其余凭据由参数或环境变量提供。
#
# 用法（PowerShell）：
#   .\scripts\run-local.ps1 -SuperPassword 'Admin@12345' -SelfAppKey 'self-console-key' -AppCenterKey 'app-center-key'
param(
    [string]$SuperPassword = $env:AUTH_SUPER_PASSWORD,
    [string]$SelfAppKey = $env:AUTH_SELF_APP_KEY,
    [string]$AppCenterKey = $env:AUTH_APP_CENTER_KEY,
    [string]$Database = $env:AUTH_DB_URL
)

$ErrorActionPreference = 'Stop'
$serviceDir = Split-Path -Parent $PSScriptRoot
$dockerEnv = Join-Path $serviceDir '..\docker\.env'

if (-not $env:AUTH_DB_PASSWORD -and (Test-Path $dockerEnv)) {
    $env:AUTH_DB_PASSWORD = (Get-Content $dockerEnv |
        Where-Object { $_ -match '^POSTGRES_PASSWORD=' } |
        ForEach-Object { ($_ -split '=', 2)[1] })
}

foreach ($pair in @(@('AUTH_SUPER_PASSWORD', $SuperPassword),
                    @('AUTH_SELF_APP_KEY', $SelfAppKey),
                    @('AUTH_APP_CENTER_KEY', $AppCenterKey))) {
    if ([string]::IsNullOrWhiteSpace($pair[1])) {
        throw "缺少 $($pair[0])；初始化内置身份需要这三个凭据"
    }
    Set-Item -Path "env:$($pair[0])" -Value $pair[1]
}
if ($Database) { $env:AUTH_DB_URL = $Database }

Push-Location $serviceDir
try {
    & mvn -q -B spring-boot:run
}
finally {
    Pop-Location
}
