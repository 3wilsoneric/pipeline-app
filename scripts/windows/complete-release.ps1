# Produces a download feed only after Windows verifies the package signature.
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $StageRoot,
    [Parameter(Mandatory)] [uri] $PublishBaseUrl
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Signature verification requires Windows.' }
if ($PublishBaseUrl.Scheme -ne 'https' -or $PublishBaseUrl.UserInfo -or $PublishBaseUrl.Query -or $PublishBaseUrl.Fragment) {
    throw 'Use an HTTPS download directory without credentials, query, or fragment.'
}
$stage = (Resolve-Path -LiteralPath $StageRoot).Path
$releasePath = Join-Path $stage 'release.json'
$release = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
$feed = Join-Path $stage 'Pipeline.appinstaller'
Remove-Item -LiteralPath $feed -ErrorAction SilentlyContinue
$release.signed = $false
$release | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $releasePath -Encoding utf8NoBOM
python scripts/windows/verify-package.py $stage --signed
if ($LASTEXITCODE -ne 0) { throw 'Package contents failed verification.' }
$package = Join-Path $stage $release.packageFile
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$signTool = Get-ChildItem -LiteralPath $sdkRoot -Directory |
    Where-Object Name -Match '^10\.0\.\d+\.0$' |
    Sort-Object { [version] $_.Name } -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $signTool) { throw 'Windows SDK SignTool is required.' }
& $signTool verify /pa /all /v $package
if ($LASTEXITCODE -ne 0) { throw 'Windows did not trust the package signature. No feed was created.' }
$base = $PublishBaseUrl.AbsoluteUri.TrimEnd('/') + '/'
$escape = { param([string] $Value) [Security.SecurityElement]::Escape($Value) }
$packageUri = & $escape ($base + $release.packageFile)
$feedUri = & $escape ($base + 'Pipeline.appinstaller')
$publisher = & $escape $release.publisher
$name = & $escape $release.packageId
@"
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2018" Version="$($release.version)" Uri="$feedUri">
  <MainBundle Name="$name" Publisher="$publisher" Version="$($release.version)" Uri="$packageUri" />
  <UpdateSettings><OnLaunch HoursBetweenUpdateChecks="8" ShowPrompt="true" UpdateBlocksActivation="false" /></UpdateSettings>
</AppInstaller>
"@ | Set-Content -LiteralPath $feed -Encoding utf8NoBOM
$release.signed = $true
$release | Add-Member -Force NoteProperty signedSha256 (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
$release | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $releasePath -Encoding utf8NoBOM
Write-Host 'Windows signature and package identity verified. Upload the versioned bundle before the update feed.'
