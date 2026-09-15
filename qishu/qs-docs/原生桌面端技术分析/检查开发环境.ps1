# Read-only checks for the desktop tutorial. Does not install or remove tools.
$ErrorActionPreference = 'Stop'
$taskRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
if (-not (Test-Path -LiteralPath (Join-Path $taskRepoRoot 'apps/desktop/package.json'))) {
    throw 'Keep this script inside applications/qs-docs/原生桌面端技术分析.'
}
$taskReport = [ordered]@{
    checkedAt = (Get-Date).ToString('o')
    repository = $taskRepoRoot
    operatingSystem = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
    processArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    tools = [ordered]@{}
    toolCommands = [ordered]@{}
    files = [ordered]@{}
    visualCppInstallation = $null
    electronBinaryPresent = $false
    orphanedSharedLinks = @()
}
foreach ($taskToolName in @('node', 'npm', 'pnpm', 'git', 'python')) {
    $taskExecutableName = $taskToolName
    if ($taskToolName -eq 'npm' -and (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue)) {
        $taskExecutableName = 'npm.cmd'
    }
    $taskReport.toolCommands[$taskToolName] = $taskExecutableName
    $taskCommand = Get-Command $taskExecutableName -ErrorAction SilentlyContinue
    if ($null -eq $taskCommand) {
        $taskReport.tools[$taskToolName] = 'NOT FOUND'
    } else {
        try {
            $taskReport.tools[$taskToolName] = ((& $taskExecutableName --version 2>&1) -join ' ').Trim()
        } catch {
            $taskReport.tools[$taskToolName] = 'CHECK FAILED'
        }
    }
}
foreach ($taskRelativePath in @('pnpm-lock.yaml', 'node_modules', 'apps/desktop/lib/main.js',
    'apps/desktop/lib/preload.cjs', 'apps/desktop/lib/preload-app.cjs',
    'apps/desktop-host/lib/index.js', 'apps/web/dist/index.html')) {
    $taskReport.files[$taskRelativePath] = Test-Path -LiteralPath (Join-Path $taskRepoRoot $taskRelativePath)
}
$taskVswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (Test-Path -LiteralPath $taskVswherePath) {
    $taskVsResult = & $taskVswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($taskVsResult) { $taskReport.visualCppInstallation = ($taskVsResult -join ' ').Trim() }
}
$taskElectronPathFile = Join-Path $taskRepoRoot 'apps/desktop/node_modules/electron/path.txt'
if (Test-Path -LiteralPath $taskElectronPathFile) {
    $taskElectronRelativeBinary = (Get-Content -LiteralPath $taskElectronPathFile -Raw).Trim()
    $taskElectronBinary = Join-Path (Split-Path -Parent $taskElectronPathFile) (Join-Path 'dist' $taskElectronRelativeBinary)
    $taskReport.electronBinaryPresent = Test-Path -LiteralPath $taskElectronBinary
}
$taskSharedRoot = Join-Path $taskRepoRoot 'node_modules/.pnpm/node_modules/@deepseek-ai'
if (Test-Path -LiteralPath $taskSharedRoot) {
    $taskReport.orphanedSharedLinks = @(Get-ChildItem -LiteralPath $taskSharedRoot -Force |
        Where-Object { $_.LinkType -and $_.LinkTarget -and -not (Test-Path -LiteralPath $_.LinkTarget) } |
        ForEach-Object { [ordered]@{ link = $_.FullName; target = $_.LinkTarget } })
}
$taskReport | ConvertTo-Json -Depth 5
