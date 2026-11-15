param(
  [string]$InstallDir = (Join-Path $HOME "execos"),
  [string]$RepoUrl = "https://github.com/calvinl345/execos.git",
  [string]$Branch = "main",
  [ValidateSet("production", "developer")]
  [string]$Profile = "production",
  [string]$DbEnvironment = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
  param(
    [string]$Name,
    [string]$InstallHint
  )
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $InstallHint"
  }
}

function Test-NodeVersion {
  $raw = (& node --version)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read Node.js version."
  }
  $version = [version]($raw.TrimStart("v"))
  if ($version.Major -lt 20) {
    throw "Node.js 20+ is required. Found $raw. Install Node LTS from https://nodejs.org/ and rerun this command."
  }
  Write-Host "Node.js $raw detected."
}

function Resolve-DbEnvironment {
  param(
    [string]$Requested,
    [string]$PromptProfile
  )

  if ([string]::IsNullOrWhiteSpace($Requested)) {
    if ($PromptProfile -eq "developer") {
      return "development"
    }
    return "production"
  }

  $normalized = $Requested.Trim().ToLowerInvariant()
  if ($normalized -ne "development" -and $normalized -ne "production") {
    throw "Unknown database environment '$Requested'. Expected 'development' or 'production'."
  }
  return $normalized
}

$resolvedDbEnvironment = Resolve-DbEnvironment $DbEnvironment $Profile

Write-Host "ExecOS Windows bootstrap"
Write-Host "Install folder: $InstallDir"
Write-Host "Profile: $Profile"
Write-Host "Database environment: $resolvedDbEnvironment"

Write-Step "Checking required tools"
Require-Command "git" "Install Git for Windows from https://git-scm.com/download/win and rerun this command."
Require-Command "node" "Install Node.js LTS 20+ from https://nodejs.org/ and rerun this command."
Require-Command "npm" "npm should be installed with Node.js. Reinstall Node.js LTS if npm is missing."
Test-NodeVersion

$parent = Split-Path -Parent $InstallDir
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Path $parent | Out-Null
}

if (-not (Test-Path -LiteralPath $InstallDir)) {
  Write-Step "Cloning ExecOS"
  & git clone --branch $Branch $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) {
    throw "git clone failed."
  }
} else {
  $gitDir = Join-Path $InstallDir ".git"
  if (-not (Test-Path -LiteralPath $gitDir)) {
    throw "Install folder already exists but is not a Git repository: $InstallDir"
  }

  Write-Step "Using existing ExecOS clone"
  $dirty = (& git -C $InstallDir status --porcelain)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect existing clone."
  }

  if ([string]::IsNullOrWhiteSpace($dirty)) {
    Write-Host "Existing clone is clean; updating from origin/$Branch."
    & git -C $InstallDir pull --ff-only origin $Branch
    if ($LASTEXITCODE -ne 0) {
      throw "git pull --ff-only failed."
    }
  } else {
    Write-Host "Existing clone has local changes; skipping git pull."
  }
}

$installer = Join-Path $InstallDir "scripts\install.ps1"
if (-not (Test-Path -LiteralPath $installer)) {
  throw "Installer not found at $installer"
}

Write-Step "Starting repo-local installer"
& powershell -ExecutionPolicy Bypass -NoProfile -File $installer -Profile $Profile -DbEnvironment $resolvedDbEnvironment
if ($LASTEXITCODE -ne 0) {
  throw "ExecOS installer failed."
}

Write-Host ""
Write-Host "ExecOS bootstrap complete." -ForegroundColor Green
Write-Host "Open your terminal or agent in: $InstallDir"
