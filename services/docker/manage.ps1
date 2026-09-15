param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('start', 'stop')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker CLI is missing. Install Docker Desktop and reopen this script.'
    }
    $dockerOs = docker info --format '{{.OSType}}'
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop in Linux container mode, then retry.' }
    if ($dockerOs -ne 'linux') { throw 'Switch Docker Desktop to Linux containers, then retry.' }
    docker compose version
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 or later is required.' }

    $envPath = Join-Path $PSScriptRoot '.env'
    if (-not (Test-Path -LiteralPath $envPath)) {
        if ($Action -eq 'stop') { throw 'Missing .env. Restore it before stopping this project.' }
        $content = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '.env.example'))
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            foreach ($key in @('REDIS_PASSWORD', 'POSTGRES_PASSWORD', 'RUSTFS_SECRET_KEY')) {
                $bytes = New-Object byte[] 24
                $rng.GetBytes($bytes)
                $secret = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
                $content = $content.Replace("__GENERATE_${key}__", $secret)
            }
        } finally { $rng.Dispose() }
        [IO.File]::WriteAllText($envPath, $content, (New-Object Text.UTF8Encoding($false)))
        Write-Host "Created $envPath with random passwords. Keep this file for future starts."
    }

    $composeArgs = @('compose', '--project-directory', $PSScriptRoot, '--env-file', $envPath,
        '-f', (Join-Path $PSScriptRoot 'docker-compose.yml'))
    & docker @composeArgs config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Invalid Compose configuration. Check .env and docker-compose.yml.' }

    if ($Action -eq 'start') {
        & docker @composeArgs up -d --wait --wait-timeout 180
        if ($LASTEXITCODE -ne 0) {
            & docker @composeArgs ps --all
            throw 'Startup failed. Check Docker output, port conflicts, and docker compose logs. Containers are retained for diagnosis.'
        }
        & docker @composeArgs ps
        if ($LASTEXITCODE -ne 0) { throw 'Unable to read service status.' }
        Write-Host 'Services are healthy. See README.md for endpoints; passwords are in .env.'
    } else {
        & docker @composeArgs down --timeout 30
        if ($LASTEXITCODE -ne 0) { throw 'Stop failed. Check Docker output and retry.' }
        Write-Host 'Services stopped. Data volumes are preserved.'
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
exit 0
