param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$Branch = "main",
  [ValidateSet("production", "developer")]
  [string]$Profile = "production",
  [string]$DbEnvironment = "",
  [switch]$SkipPull,
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipDatabase,
  [switch]$AllowProductionDatabaseChanges,
  [switch]$NoClearScreen
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

function Get-EnvFileName {
  param([string]$Environment)
  if ($Environment -eq "development") {
    return ".env.development.local"
  }
  return ".env.production.local"
}

$resolvedDbEnvironment = Resolve-DbEnvironment $DbEnvironment $Profile
$envFileName = Get-EnvFileName $resolvedDbEnvironment
$envPath = Join-Path $RepoRoot $envFileName
$installer = Join-Path $RepoRoot "scripts\install.ps1"

Write-Host "ExecOS updater"
Write-Host "Repo: $RepoRoot"
Write-Host "Profile: $Profile"
Write-Host "Database environment: $resolvedDbEnvironment"

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git"))) {
  throw "Repo root is not a Git checkout: $RepoRoot"
}
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Cannot update without $envFileName. Run scripts/install.ps1 once first."
}
if (-not (Test-Path -LiteralPath $installer)) {
  throw "Installer not found at $installer"
}

Require-Command "git" "Install Git for Windows from https://git-scm.com/download/win and rerun this command."

if (-not $SkipPull) {
  Write-Step "Checking for local tracked changes"
  & git -C $RepoRoot diff --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "Tracked working-tree changes are present. Commit, stash, or rerun with -SkipPull to update dependencies/builds without pulling."
  }
  & git -C $RepoRoot diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "Staged changes are present. Commit, unstage, or rerun with -SkipPull to update dependencies/builds without pulling."
  }

  Write-Step "Pulling latest changes"
  & git -C $RepoRoot pull --ff-only origin $Branch
  if ($LASTEXITCODE -ne 0) {
    throw "git pull --ff-only failed."
  }
} else {
  Write-Step "Skipping git pull"
}

$installArgs = @(
  "-ExecutionPolicy",
  "Bypass",
  "-NoProfile",
  "-File",
  $installer,
  "-RepoRoot",
  $RepoRoot,
  "-Profile",
  $Profile,
  "-DbEnvironment",
  $resolvedDbEnvironment,
  "-UseExistingCredentials"
)
if ($SkipInstall) { $installArgs += "-SkipInstall" }
if ($SkipBuild) { $installArgs += "-SkipBuild" }
if ($SkipDatabase) { $installArgs += "-SkipDatabase" }
if ($AllowProductionDatabaseChanges) { $installArgs += "-AllowProductionDatabaseChanges" }
if ($NoClearScreen) { $installArgs += "-NoClearScreen" }

Write-Step "Running installer update mode"
& powershell @installArgs
if ($LASTEXITCODE -ne 0) {
  throw "Jordan update failed."
}

Write-Host ""
Write-Host "ExecOS update complete." -ForegroundColor Green
Write-Host "The updater ran the dashboard start command after finishing."
