param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipDatabase,
  [switch]$UseExistingCredentials,
  [switch]$AllowProductionDatabaseChanges,
  [switch]$NoClearScreen,
  [ValidateSet("production", "developer")]
  [string]$Profile = "production",
  [string]$DbEnvironment = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
$script:InstallFailed = $false
$script:InstallFailureMessage = ""
$script:CommandPublishWarning = ""
$script:InstallerProfileLabel = $Profile
$script:InstallerDbEnvironmentLabel = ""
$script:InstallerEnvFileLabel = ""
$script:UseAnsiText = [bool](
  ($PSVersionTable.PSVersion.Major -ge 7) -or
  (-not [string]::IsNullOrWhiteSpace($env:WT_SESSION)) -or
  (-not [string]::IsNullOrWhiteSpace($env:TERM_PROGRAM)) -or
  ($env:TERM -match 'xterm|ansi|vt100')
)
$script:ProductionMigrateAck = "I_UNDERSTAND_THIS_MUTATES_PRODUCTION"

function Format-Bold {
  param([string]$Text)
  if ($script:UseAnsiText) {
    $esc = [char]27
    return "$esc[1m$Text$esc[22m"
  }
  return $Text
}

function Write-LabelLine {
  param(
    [string]$Label,
    [string]$Value,
    [string]$Indent = "  "
  )
  Write-Host "$Indent$(Format-Bold "${Label}:") $Value"
}

function Write-ProfileBadge {
  $parts = @()
  if (-not [string]::IsNullOrWhiteSpace($script:InstallerProfileLabel)) {
    $parts += "Profile: $script:InstallerProfileLabel"
  }
  if (-not [string]::IsNullOrWhiteSpace($script:InstallerDbEnvironmentLabel)) {
    $parts += "DB: $script:InstallerDbEnvironmentLabel"
  }
  if (-not [string]::IsNullOrWhiteSpace($script:InstallerEnvFileLabel)) {
    $parts += "Env: $script:InstallerEnvFileLabel"
  }
  if ($parts.Count -gt 0) {
    Write-Host "[$($parts -join ' | ')]" -ForegroundColor DarkCyan
  }
}

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host (Format-Bold "==> $Message") -ForegroundColor Cyan
}

function Clear-SetupScreen {
  if ($NoClearScreen) {
    return
  }
  try {
    Clear-Host
  } catch {
    Write-Host ""
  }
}

function Write-Logo {
  $block = [string][char]0x2588
  $downRight = [string][char]0x2557
  $downLeft = [string][char]0x2554
  $upRight = [string][char]0x255D
  $upLeft = [string][char]0x255A
  $vertical = [string][char]0x2551
  $horizontal = [string][char]0x2550

  # "EXEC" renders in yellow and "OS" in cyan, side by side.
  $execTemplates = @(
    '@@@@@@@>@@>  @@>@@@@@@@> @@@@@@>',
    '@@<====/\@@>@@</@@<====/@@<====/',
    '@@@@@>   \@@@</ @@@@@>  @@|     ',
    '@@<==/   @@<@@> @@<==/  @@|     ',
    '@@@@@@@>@@</ @@>@@@@@@@>\@@@@@@>',
    '\======/\=/  \=/\======/ \=====/'
  )
  $osTemplates = @(
    ' @@@@@@> @@@@@@@>',
    '@@<===@@>@@<====/',
    '@@|   @@|@@@@@@@>',
    '@@|   @@|\====@@|',
    '\@@@@@@</@@@@@@@|',
    ' \=====/ \======/'
  )

  $render = {
    param([string]$Template)
    $Template.Replace('@', $block).
      Replace('>', $downRight).
      Replace('<', $downLeft).
      Replace('/', $upRight).
      Replace('\', $upLeft).
      Replace('|', $vertical).
      Replace('=', $horizontal)
  }

  Write-Host ""
  for ($i = 0; $i -lt $execTemplates.Count; $i++) {
    Write-Host (& $render $execTemplates[$i]) -ForegroundColor Yellow -NoNewline
    Write-Host "  " -NoNewline
    Write-Host (& $render $osTemplates[$i]) -ForegroundColor Cyan
  }
  Write-Host ""
  Write-Host "An AI chief of staff for founders" -ForegroundColor Cyan
  Write-Host "ExecOS v0.1" -ForegroundColor DarkYellow
  Write-Host ""
}

function Write-Banner {
  Clear-SetupScreen
  Write-Logo
  Write-ProfileBadge
  Write-Host ""
  Write-Host (Format-Bold "Repo-local setup") -ForegroundColor Cyan
  Write-Host "Configures the repo-local ExecOS app on this machine."
  Write-Host ""
  Write-Host (Format-Bold "Have these values ready:") -ForegroundColor Cyan
  Write-LabelLine "Project ID" "Supabase Project Settings -> General"
  Write-LabelLine "API keys" "Supabase Project Settings -> API Keys"
  Write-LabelLine "Extensions" "Supabase Database -> Extensions: enable vector and pg_trgm"
  Write-LabelLine "DATABASE_URL" "Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env"
  Write-LabelLine "OpenAI API key" "Used for memory embeddings"
  Write-LabelLine "Supabase" "https://supabase.com/dashboard/projects"
  Write-LabelLine "OpenAI" "https://platform.openai.com/api-keys"
  Write-Host ""
  [void](Read-Host "Press Enter when ready for credential prompts")
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
  if ($Environment -eq "production") {
    return ".env.production.local"
  }
  throw "Unknown database environment '$Environment'."
}

function Write-ProgressLine {
  param(
    [int]$Step,
    [int]$TotalSteps
  )
  $width = 24
  $filled = [Math]::Floor(($Step / $TotalSteps) * $width)
  $bar = ("#" * $filled) + ("-" * ($width - $filled))
  Write-Host "Step $Step of $TotalSteps  [$bar]" -ForegroundColor DarkCyan
}

function Write-CredentialScreen {
  param(
    [string]$Title,
    [string[]]$Help,
    [int]$Step,
    [int]$TotalSteps,
    [bool]$Secret,
    [bool]$HasExisting,
    [string]$DefaultValue,
    [string]$ErrorMessage = ""
  )
  Clear-SetupScreen
  Write-Logo
  Write-ProfileBadge
  Write-ProgressLine $Step $TotalSteps
  Write-Host ""
  Write-Host (Format-Bold $Title) -ForegroundColor Cyan
  foreach ($line in $Help) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      Write-Host ""
    } elseif ($line -match '^([^:]+):\s+(.+)$') {
      Write-LabelLine $matches[1] $matches[2]
    } else {
      Write-Host "  $line"
    }
  }
  if ($Secret) {
    Write-Host "  Input is hidden while you type."
  }
  if ($HasExisting) {
    Write-Host "  Existing value found. Press Enter to keep it."
  } elseif (-not [string]::IsNullOrWhiteSpace($DefaultValue)) {
    Write-Host "  Press Enter to use the default: $DefaultValue"
  }
  if (-not [string]::IsNullOrWhiteSpace($ErrorMessage)) {
    Write-Host ""
    Write-Host $ErrorMessage -ForegroundColor Yellow
  }
  Write-Host ""
}

function Write-SupabaseExtensionsScreen {
  param(
    [string]$ProjectId,
    [int]$Step,
    [int]$TotalSteps
  )
  $extensionsUrl = "https://supabase.com/dashboard/project/$ProjectId/database/extensions"
  Clear-SetupScreen
  Write-Logo
  Write-ProfileBadge
  Write-ProgressLine $Step $TotalSteps
  Write-Host ""
  Write-Host (Format-Bold "2. Enable Supabase extensions") -ForegroundColor Cyan
  Write-Host "  Supabase does not always enable Jordan's required Postgres extensions by default."
  Write-Host "  Open the project extensions page:"
  Write-LabelLine "Open" $extensionsUrl
  Write-Host ""
  Write-Host "  Enable these two extensions:"
  Write-Host "    vector"
  Write-Host "    pg_trgm"
  Write-Host ""
  Write-Host "  The installer will verify this before running migrations."
  Write-Host ""
  [void](Read-Host "Press Enter after both extensions are enabled")
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

function Test-CommandExists {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Split-PathEntries {
  param([AllowNull()][string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return @()
  }

  return @(
    $Value -split ";" |
      ForEach-Object { $_.Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )
}

function Normalize-PathForComparison {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  $expanded = [System.Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"'))
  try {
    return ([System.IO.Path]::GetFullPath($expanded).TrimEnd([char[]]@([char]'\', [char]'/'))).ToUpperInvariant()
  } catch {
    return $expanded.TrimEnd([char[]]@([char]'\', [char]'/')).ToUpperInvariant()
  }
}

function Test-DirectoryOnPath {
  param(
    [string]$Directory,
    [AllowNull()][string]$PathValue
  )

  $normalizedDirectory = Normalize-PathForComparison $Directory
  foreach ($entry in (Split-PathEntries $PathValue)) {
    if ((Normalize-PathForComparison $entry) -eq $normalizedDirectory) {
      return $true
    }
  }

  return $false
}

function Update-PathFromRegistry {
  # winget installs add to the registry-level PATH, but the running PowerShell
  # session keeps its launch-time copy. Refresh from registry so a freshly
  # installed CLI becomes visible without restarting the shell.
  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  if ([string]::IsNullOrWhiteSpace($userPath)) {
    $env:Path = $machinePath
  } else {
    $env:Path = "$machinePath;$userPath"
  }
}

function Add-DirectoryToUserPath {
  param([string]$Directory)

  if ([string]::IsNullOrWhiteSpace($Directory)) {
    return $false
  }

  $resolvedDirectory = [System.IO.Path]::GetFullPath($Directory)
  if (-not (Test-Path -LiteralPath $resolvedDirectory -PathType Container)) {
    return $false
  }

  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Test-DirectoryOnPath $resolvedDirectory $userPath)) {
    $entries = @(Split-PathEntries $userPath)
    $updatedUserPath = (@($entries) + $resolvedDirectory) -join ";"
    [System.Environment]::SetEnvironmentVariable("Path", $updatedUserPath, "User")
  }

  Update-PathFromRegistry
  if (-not (Test-DirectoryOnPath $resolvedDirectory $env:Path)) {
    if ([string]::IsNullOrWhiteSpace($env:Path)) {
      $env:Path = $resolvedDirectory
    } else {
      $env:Path = "$env:Path;$resolvedDirectory"
    }
  }

  return $true
}

function Find-GitHubCliExecutable {
  $command = Get-Command "gh" -ErrorAction SilentlyContinue
  if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
    return $command.Source
  }

  $candidatePaths = @()
  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
    $candidatePaths += (Join-Path $env:ProgramFiles "GitHub CLI\gh.exe")
  }

  $programFilesX86 = [System.Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
    $candidatePaths += (Join-Path $programFilesX86 "GitHub CLI\gh.exe")
  }

  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $candidatePaths += (Join-Path $env:LOCALAPPDATA "Programs\GitHub CLI\gh.exe")
  }

  foreach ($candidatePath in $candidatePaths) {
    if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidatePath).Path
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $wingetPackageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path -LiteralPath $wingetPackageRoot -PathType Container) {
      $wingetGh = Get-ChildItem -LiteralPath $wingetPackageRoot -Filter "gh.exe" -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*GitHub.cli*" } |
        Select-Object -First 1
      if ($wingetGh) {
        return $wingetGh.FullName
      }
    }
  }

  return $null
}

function Repair-GitHubCliPath {
  $ghPath = Find-GitHubCliExecutable
  if ([string]::IsNullOrWhiteSpace($ghPath)) {
    return $false
  }

  $ghDirectory = Split-Path -Parent $ghPath
  if (-not (Add-DirectoryToUserPath $ghDirectory)) {
    return $false
  }

  return (Test-CommandExists "gh")
}

function Ensure-GitHubCli {
  # The report-issue-prod and resolve-requests-dev skills shell out to `gh`
  # for issue create / list / close. Installing gh here is a soft pre-flight:
  # if it fails we keep going and leave the user with a manual-install hint,
  # because the rest of ExecOS does not depend on gh.

  if (Test-CommandExists "gh") {
    Write-Host "GitHub CLI (gh) detected."
    return $true
  }

  try {
    if (Repair-GitHubCliPath) {
      Write-Host "GitHub CLI (gh) detected and added to user PATH."
      return $true
    }
  } catch {
    Write-Host "GitHub CLI PATH repair skipped: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host (Format-Bold "GitHub CLI not found.") -ForegroundColor Cyan
  Write-Host "  gh is used by the report-issue and resolve-requests skills"
  Write-Host "  to file and resolve bug reports as GitHub issues from chat."

  if (-not (Test-CommandExists "winget")) {
    Write-Host ""
    Write-Host "  winget is not available on this machine, so I can't auto-install gh." -ForegroundColor Yellow
    Write-Host "  Install gh manually from https://cli.github.com/ when convenient."
    Write-Host "  Continuing the installer without it."
    return $false
  }

  Write-Step "Installing GitHub CLI (gh) via winget"
  Write-Host "One-time install. About 30 seconds."
  try {
    & winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements
    $exit = $LASTEXITCODE
  } catch {
    $exit = -1
    Write-Host ""
    Write-Host "winget threw: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  if ($exit -ne 0) {
    Write-Host ""
    Write-Host "winget install of GitHub.cli exited with code $exit." -ForegroundColor Yellow
    Write-Host "Install gh manually from https://cli.github.com/ when convenient."
    Write-Host "Continuing the installer without it."
    return $false
  }

  Update-PathFromRegistry
  if (Test-CommandExists "gh") {
    Write-Host "GitHub CLI installed." -ForegroundColor Green
    return $true
  }

  try {
    if (Repair-GitHubCliPath) {
      Write-Host "GitHub CLI installed and added to user PATH." -ForegroundColor Green
      return $true
    }
  } catch {
    Write-Host "GitHub CLI PATH repair skipped: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "GitHub CLI installed but is not on this session's PATH yet." -ForegroundColor Yellow
  Write-Host "Open a new terminal after this installer completes and the next 'gh' invocation will pick it up."
  return $true
}

function Assert-NodeVersion {
  $raw = (& node --version)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read Node.js version."
  }
  $version = [version]($raw.TrimStart("v"))
  if ($version.Major -lt 20) {
    throw "Node.js 20+ is required. Found $raw. Install Node LTS from https://nodejs.org/ and rerun this script."
  }
  Write-Host "Node.js $raw detected."
}

function ConvertTo-PlainText {
  param([System.Security.SecureString]$Secure)
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Unquote-EnvValue {
  param([string]$Value)
  $trimmed = $Value.Trim()
  if ($trimmed.Length -ge 2 -and $trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) {
    $inner = $trimmed.Substring(1, $trimmed.Length - 2)
    return $inner.Replace('\"', '"').Replace('\\', '\')
  }
  return $trimmed
}

function Remove-EnvInlineComment {
  param([string]$Value)

  $inSingle = $false
  $inDouble = $false
  for ($i = 0; $i -lt $Value.Length; $i++) {
    $char = $Value[$i]
    if ($char -eq "'" -and -not $inDouble) {
      $inSingle = -not $inSingle
      continue
    }
    if ($char -eq '"' -and -not $inSingle) {
      $escaped = $i -gt 0 -and $Value[$i - 1] -eq '\'
      if (-not $escaped) {
        $inDouble = -not $inDouble
      }
      continue
    }
    if ($char -eq '#' -and -not $inSingle -and -not $inDouble) {
      if ($i -eq 0 -or [char]::IsWhiteSpace($Value[$i - 1])) {
        return $Value.Substring(0, $i).TrimEnd()
      }
    }
  }
  return $Value
}

function Read-ExistingEnv {
  param([string]$Path)
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') {
      $values[$matches[1]] = Unquote-EnvValue (Remove-EnvInlineComment $matches[2])
    }
  }
  return $values
}

function Get-ExistingOrDefault {
  param(
    [string]$Key,
    [hashtable]$Existing,
    [string]$DefaultValue
  )
  if ($Existing.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace([string]$Existing[$Key])) {
    return [string]$Existing[$Key]
  }
  return $DefaultValue
}

function Read-ConfigValue {
  param(
    [string]$Key,
    [string]$Prompt,
    [hashtable]$Existing,
    [switch]$Required,
    [switch]$Secret,
    [string]$DefaultValue = "",
    [string[]]$Help = @(),
    [scriptblock]$Normalize = $null,
    [int]$Step = 1,
    [int]$TotalSteps = 1
  )

  $hasExisting = $Existing.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace([string]$Existing[$Key])
  $suffix = ""
  if ($hasExisting) {
    $suffix = " [press Enter to keep existing]"
  } elseif (-not [string]::IsNullOrWhiteSpace($DefaultValue)) {
    $suffix = " [$DefaultValue]"
  } elseif (-not $Required) {
    $suffix = " [optional]"
  }

  $errorMessage = ""
  $helpLines = $Help
  if ($helpLines.Count -eq 0) {
    $helpLines = @("Enter the value for $Key.")
  }

  while ($true) {
    Write-CredentialScreen $Prompt $helpLines $Step $TotalSteps ([bool]$Secret) $hasExisting $DefaultValue $errorMessage
    if ($Secret) {
      $secure = Read-Host "Value$suffix" -AsSecureString
      $value = ConvertTo-PlainText $secure
    } else {
      $value = Read-Host "Value$suffix"
    }

    if ([string]::IsNullOrWhiteSpace($value)) {
      if ($hasExisting) {
        $candidate = [string]$Existing[$Key]
      } elseif (-not [string]::IsNullOrWhiteSpace($DefaultValue)) {
        $candidate = $DefaultValue
      } elseif (-not $Required) {
        return ""
      } else {
        $errorMessage = "$Key is required."
        continue
      }
    } else {
      $candidate = $value.Trim()
    }

    try {
      if ($null -ne $Normalize) {
        return & $Normalize $candidate
      }
      return $candidate
    } catch {
      $errorMessage = $_.Exception.Message
    }
  }
}

function Convert-SupabaseProjectInputToProjectId {
  param([string]$Value)

  $trimmed = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    return ""
  }

  if ($trimmed -match '^https://([a-z0-9-]+)\.supabase\.co(?:/rest/v1)?/?$') {
    return $matches[1]
  }

  if ($trimmed -match '^([a-z0-9-]+)\.supabase\.co(?:/rest/v1)?/?$') {
    return $matches[1]
  }

  if ($trimmed -match '^[a-z0-9-]+$') {
    return $trimmed
  }

  throw "Supabase Project ID must look like abc123, or a project URL like https://abc123.supabase.co."
}

function Convert-SupabaseProjectInputToUrl {
  param([string]$Value)

  $projectId = Convert-SupabaseProjectInputToProjectId $Value
  if ([string]::IsNullOrWhiteSpace($projectId)) {
    return ""
  }
  return "https://$projectId.supabase.co"
}

function Convert-DatabaseUrlInput {
  param([string]$Value)

  $trimmed = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    return ""
  }

  if ($trimmed -match '^(?i:DATABASE_URL)\s*=\s*(.+)$') {
    $trimmed = $matches[1].Trim()
  }
  if ($trimmed.Length -ge 2) {
    $first = $trimmed[0]
    $last = $trimmed[$trimmed.Length - 1]
    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
      $trimmed = $trimmed.Substring(1, $trimmed.Length - 2).Trim()
    }
  }

  if ($trimmed -eq "[YOUR-PASSWORD]") {
    throw "Paste the full DATABASE_URL from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env, not only the database password."
  }

  if ($trimmed -notmatch '^postgres(?:ql)?://') {
    throw "DATABASE_URL must be the full Postgres URI from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env."
  }

  if ($trimmed.Contains("[YOUR-PASSWORD]")) {
    throw "Replace [YOUR-PASSWORD] in DATABASE_URL with this project's database password."
  }

  $urlHadFragment = $false
  try {
    $uri = [System.Uri]$trimmed
    $urlHadFragment = -not [string]::IsNullOrEmpty($uri.Fragment)
  } catch {
    # Try to repair the common Supabase case below: a raw database password
    # with URI-reserved characters such as # pasted into the connection string.
  }

  $match = [regex]::Match($trimmed, '^(postgres(?:ql)?://[^:]+:)(.+)@([^/@]+(?::\d+)?/.+)$')
  $repaired = $trimmed
  if (($urlHadFragment -or $trimmed.Contains("#")) -and $match.Success) {
    $prefix = $match.Groups[1].Value
    $rawPassword = $match.Groups[2].Value
    $suffix = $match.Groups[3].Value
    $repaired = $prefix + [System.Uri]::EscapeDataString($rawPassword) + "@" + $suffix
  }

  try {
    $uri = [System.Uri]$repaired
  } catch {
    throw "DATABASE_URL is not a valid Postgres URI: $($_.Exception.Message)"
  }

  if ($uri.Scheme -ne "postgres" -and $uri.Scheme -ne "postgresql") {
    throw "DATABASE_URL must start with postgres:// or postgresql://."
  }

  if ($uri.AbsolutePath.TrimEnd("/") -ne "/postgres") {
    throw "Supabase DATABASE_URL should end with /postgres."
  }

  return $repaired
}

function Write-TextFile {
  param(
    [string]$Path,
    [string[]]$Lines
  )
  $parent = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($Path, $Lines, $utf8NoBom)
}

function Get-InstallCommand {
  param(
    [string]$PromptProfile,
    [string]$RequestedDbEnvironment
  )

  $parts = @(
    "powershell",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ".\scripts\install.ps1",
    "-Profile",
    $PromptProfile
  )
  if (-not [string]::IsNullOrWhiteSpace($RequestedDbEnvironment)) {
    $parts += @("-DbEnvironment", $RequestedDbEnvironment.Trim())
  }
  return Join-ProcessArguments $parts
}

function Get-IncompleteInstallPromptLines {
  param(
    [string]$RepoRoot,
    [string]$PromptProfile,
    [string]$DbEnvironment,
    [string]$InstallCommand
  )

  return @(
    "# ExecOS Installation Incomplete",
    "",
    "This checkout has not completed scripts/install.ps1 successfully.",
    "",
    "Do not run ExecOS operational workflows yet, including task management, dashboard launch, memory, review, resource upload, database migration, or health-check commands.",
    "",
    "If the user asks for Jordan help, tell them setup is incomplete and ask them to rerun the installer from the repo root:",
    "",
    '```powershell',
    "cd `"$RepoRoot`"",
    $InstallCommand,
    '```',
    "",
    "Installer target profile: $PromptProfile",
    "Installer database environment: $DbEnvironment",
    "",
    "After the installer completes, it will replace this temporary guidance with the selected profile's full instructions and skills.",
    "",
    "Do not invent credentials, do not ask the user to paste secrets into chat, and do not manually edit env files unless the user explicitly asks for repair help."
  )
}

function Write-IncompleteInstallSkill {
  param(
    [string]$SkillsRoot,
    [string]$InstallCommand
  )

  if (Test-Path -LiteralPath $SkillsRoot) {
    Remove-Item -LiteralPath $SkillsRoot -Recurse -Force
  }
  $skillPath = Join-Path $SkillsRoot "install-required\SKILL.md"
  Write-TextFile $skillPath @(
    "# Installation Required",
    "",
    "Use when the user asks to operate ExecOS, open the dashboard, manage tasks, run reviews, save resources, query memory, or use project-specific Jordan workflows.",
    "",
    "ExecOS installation has not completed successfully in this checkout. Do not run operational Jordan commands.",
    "",
    "Tell the user to rerun the installer from the repo root:",
    "",
    '```powershell',
    $InstallCommand,
    '```',
    "",
    "Once the installer completes, this temporary skill will be replaced by the selected profile's real skills."
  )
}

function Write-PendingInstallProfile {
  param(
    [string]$RepoRoot,
    [string]$PromptProfile,
    [string]$DbEnvironment,
    [string]$InstallCommand
  )

  $materializer = Join-Path $RepoRoot "scripts\installer\materialize.mjs"
  if (-not (Test-Path -LiteralPath $materializer -PathType Leaf)) {
    throw "Profile materializer not found: $materializer"
  }

  & node $materializer write-pending --platform windows --profile $PromptProfile --db-environment $DbEnvironment --repo-root $RepoRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Pending-install profile materialization failed."
  }
}

function Backup-ExistingEnv {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = "$Path.backup-$timestamp"
  Copy-Item -LiteralPath $Path -Destination $backupPath -Force
  return $backupPath
}

function Format-EnvLine {
  param(
    [string]$Key,
    [string]$Value
  )
  $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
  return "$Key=`"$escaped`""
}

function Write-RepoEnv {
  param(
    [string]$Path,
    [hashtable]$Values,
    [string[]]$Order
  )

  $lines = @(
    "# ExecOS repo-local environment configuration",
    "# Generated by scripts/install.ps1. Do not commit this file.",
    "# MCP integration credentials are managed by the agent harness, not this installer.",
    ""
  )
  foreach ($key in $Order) {
    $lines += Format-EnvLine $key ([string]$Values[$key])
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($Path, $lines, $utf8NoBom)
}

function Write-RepoEnvAtomically {
  param(
    [string]$Path,
    [hashtable]$Values,
    [string[]]$Order
  )

  $tempPath = "$Path.installing-final-$PID.tmp"
  try {
    Write-RepoEnv $tempPath $Values $Order
    Move-Item -LiteralPath $tempPath -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $tempPath) {
      Remove-Item -LiteralPath $tempPath -Force
    }
  }
}

function Move-LegacyEnvAfterMigration {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = "$Path.legacy.backup-$timestamp"
  if (Test-Path -LiteralPath $backupPath) {
    $backupPath = "$backupPath-$PID"
  }
  Move-Item -LiteralPath $Path -Destination $backupPath -Force
  return $backupPath
}

function Remove-IfExists {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Force
  }
}

function Remove-OrphanTempEnvFiles {
  param(
    [string]$RepoRoot,
    [string]$EnvFileName,
    [int]$CurrentPid
  )
  $pattern = "$EnvFileName.installing-*.tmp"
  $currentName = "$EnvFileName.installing-$CurrentPid.tmp"
  Get-ChildItem -LiteralPath $RepoRoot -Filter $pattern -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne $currentName } |
    ForEach-Object {
      try { Remove-Item -LiteralPath $_.FullName -Force } catch {}
    }
}

function Set-RestrictiveAcl {
  param([string]$Path)
  try {
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $true)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "Allow")
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
  } catch {
    # Best effort only. Some Windows setups do not grant ACL-edit privileges
    # to the current PowerShell process, and setup should not fail for that.
  }
}

function Format-ProcessArgument {
  param([string]$Argument)
  if ($null -eq $Argument -or $Argument.Length -eq 0) {
    return '""'
  }
  if ($Argument -notmatch '[\s"]') {
    return $Argument
  }
  return '"' + $Argument.Replace('"', '\"') + '"'
}

function Join-ProcessArguments {
  param([string[]]$Arguments)
  return (($Arguments | ForEach-Object { Format-ProcessArgument $_ }) -join " ")
}

function Format-PowerShellLiteral {
  param([string]$Value)
  return [string]::Concat("'", $Value.Replace("'", "''"), "'")
}

function Test-LocalTcpPortOpen {
  param([int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connect = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(250, $false)) {
      return $false
    }
    $client.EndConnect($connect)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-LiveDashboardPid {
  param([string]$RepoRoot)

  $pidPath = Get-DashboardPidPath $RepoRoot
  if (-not (Test-Path -LiteralPath $pidPath)) {
    return $null
  }

  $raw = (Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
  $dashboardPid = 0
  if (-not [int]::TryParse([string]$raw, [ref]$dashboardPid) -or $dashboardPid -le 0) {
    return $null
  }

  $process = Get-Process -Id $dashboardPid -ErrorAction SilentlyContinue
  if ($process) {
    return $dashboardPid
  }
  return $null
}

function Get-DashboardPidPath {
  param([string]$RepoRoot)
  return (Join-Path $RepoRoot ".cache\dashboard.pid")
}

function Stop-DashboardPidForRuntimeUpdate {
  param(
    [string]$RepoRoot,
    [int]$DashboardPid
  )

  $process = Get-Process -Id $DashboardPid -ErrorAction SilentlyContinue
  if (-not $process) {
    Remove-Item -LiteralPath (Get-DashboardPidPath $RepoRoot) -Force -ErrorAction SilentlyContinue
    return
  }

  Stop-Process -Id $DashboardPid -Force -ErrorAction Stop
  Start-Sleep -Seconds 1
  if (Get-Process -Id $DashboardPid -ErrorAction SilentlyContinue) {
    throw "Dashboard pid $DashboardPid is still running after direct stop."
  }
  Remove-Item -LiteralPath (Get-DashboardPidPath $RepoRoot) -Force -ErrorAction SilentlyContinue
}

function Get-DashboardCliArgs {
  param(
    [string]$EnvPath,
    [string]$ResolvedDbEnvironment,
    [string]$Command
  )

  return @("scripts/run-with-env.cjs", $EnvPath, "node", "--import=tsx", "src/cli/index.ts", "dashboard", $Command)
}

function Invoke-DashboardCli {
  param(
    [string]$NodePath,
    [string]$RepoRoot,
    [string]$EnvPath,
    [string]$ResolvedDbEnvironment,
    [string]$Command
  )

  $args = Get-DashboardCliArgs $EnvPath $ResolvedDbEnvironment $Command
  & $NodePath @args
  return $LASTEXITCODE
}

function Stop-DashboardForInstall {
  param(
    [string]$NodePath,
    [string]$RepoRoot,
    [string]$EnvPath,
    [string]$ResolvedDbEnvironment,
    [int]$DashboardPort
  )

  $dashboardPid = Get-LiveDashboardPid $RepoRoot
  if ($null -eq $dashboardPid) {
    if (Test-LocalTcpPortOpen $DashboardPort) {
      Write-Host "Dashboard port $DashboardPort is in use, but this checkout has no live dashboard PID recorded. Leaving that process alone." -ForegroundColor Yellow
    }
    return $false
  }

  Write-Step "Stopping dashboard before install/update"
  try {
    Stop-DashboardPidForRuntimeUpdate -RepoRoot $RepoRoot -DashboardPid $dashboardPid
  } catch {
    throw "Dashboard pid $dashboardPid could not be stopped before updating runtime files: $($_.Exception.Message)"
  }

  return $true
}

function Start-DashboardAfterInstall {
  param(
    [string]$NodePath,
    [string]$RepoRoot,
    [string]$EnvPath,
    [string]$ResolvedDbEnvironment
  )

  Write-Step "Starting dashboard"
  $code = Invoke-DashboardCli $NodePath $RepoRoot $EnvPath $ResolvedDbEnvironment "start"
  if ($code -ne 0) {
    Write-Host "Warning: install/update completed, but dashboard start failed. Run execos dashboard start manually." -ForegroundColor Yellow
  }
}

function Get-NpmCommandPath {
  $candidateNames = if ($env:OS -eq "Windows_NT") {
    @("npm.cmd", "npm.exe", "npm")
  } else {
    @("npm")
  }

  foreach ($name in $candidateNames) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  throw "Could not find npm on PATH. Reinstall Node.js LTS from https://nodejs.org/ and rerun this script."
}

function Ensure-ExecosCommandOnPath {
  param(
    [string]$NpmPath,
    [string]$CommandName
  )

  $prefixOutput = & $NpmPath prefix -g
  if ($LASTEXITCODE -ne 0) {
    throw "npm link completed, but npm prefix -g failed while checking the execos command."
  }

  $globalPrefix = ([string]$prefixOutput).Trim()
  if (-not [string]::IsNullOrWhiteSpace($globalPrefix)) {
    [void](Add-DirectoryToUserPath $globalPrefix)
    Remove-Item -LiteralPath (Join-Path $globalPrefix "execos.ps1") -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $globalPrefix "execos.ps1") -Force -ErrorAction SilentlyContinue
  }

  $execosCommand = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $execosCommand) {
    if (-not [string]::IsNullOrWhiteSpace($script:CommandPublishWarning)) {
      Write-Host "Warning: $CommandName is not available on PATH yet." -ForegroundColor Yellow
      return
    }
    throw "npm link completed, but '$CommandName' is still not on PATH. Add npm's global prefix to PATH or rerun the installer in a new terminal."
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $helpExitCode = 1
  try {
    $ErrorActionPreference = "Continue"
    & $execosCommand.Source --help *> $null
    $helpExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($helpExitCode -ne 0) {
    if (-not [string]::IsNullOrWhiteSpace($script:CommandPublishWarning)) {
      Write-Host "Warning: $CommandName was found, but '$CommandName --help' did not run successfully." -ForegroundColor Yellow
      return
    }
    throw "npm link completed, but '$CommandName --help' did not run successfully."
  }

  Write-Host "ExecOS CLI command detected: $($execosCommand.Source)" -ForegroundColor Green
}

function Set-ExecosLiveTarget {
  param(
    [string]$NodePath,
    [string]$ResolvedDbEnvironment
  )

  Write-Step "Setting active target"
  & $NodePath "scripts/execos-target.mjs" "use" $ResolvedDbEnvironment
  if ($LASTEXITCODE -ne 0) {
    throw "Could not set active ExecOS target to '$ResolvedDbEnvironment'."
  }
}

function New-InstallLogPath {
  param(
    [string]$Label,
    [string]$Stream
  )
  $logRoot = Join-Path $env:TEMP "execos-install"
  New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
  $safeLabel = ($Label.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if ([string]::IsNullOrWhiteSpace($safeLabel)) {
    $safeLabel = "step"
  }
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  return Join-Path $logRoot "$timestamp-$safeLabel-$Stream.log"
}

function New-InstallRunnerPath {
  param([string]$Label)
  $logRoot = Join-Path $env:TEMP "execos-install"
  New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
  $safeLabel = ($Label.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if ([string]::IsNullOrWhiteSpace($safeLabel)) {
    $safeLabel = "step"
  }
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  return Join-Path $logRoot "$timestamp-$safeLabel-runner.ps1"
}

function Write-InstallScreen {
  param(
    [string]$Label,
    [string]$Status,
    [int]$Step,
    [int]$TotalSteps,
    [string]$LogPath,
    [string]$Spinner = ""
  )
  Clear-SetupScreen
  $script:LastInstallStatusLength = 0
  Write-Logo
  Write-ProfileBadge
  Write-ProgressLine $Step $TotalSteps
  Write-Host ""
  Write-Host (Format-Bold "Installing ExecOS") -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Command output is being captured so the installer stays readable."
  Write-Host "Log: $LogPath" -ForegroundColor DarkGray
  Write-Host ""
  Write-InstallStatusLine $Label $Status $Spinner
}

function Write-InstallStatusLine {
  param(
    [string]$Label,
    [string]$Status,
    [string]$Spinner = ""
  )
  $text = "$Spinner $Label - $Status"
  try {
    $maxWidth = [Math]::Max(20, [Console]::WindowWidth - 1)
    if ($text.Length -gt $maxWidth) {
      $text = $text.Substring(0, $maxWidth - 3) + "..."
    }
    $clearLength = [Math]::Max($script:LastInstallStatusLength, $text.Length)
    [Console]::Write("`r" + $text.PadRight($clearLength))
    $script:LastInstallStatusLength = $text.Length
  } catch {
    Write-Host $text
  }
}

function Write-WelcomeScreen {
  param(
    [string]$RepoRoot,
    [string]$Profile,
    [string]$DbEnvironment,
    [string]$EnvFileName,
    [string]$DashboardPort,
    [string]$Timezone,
    [string]$CommandPublishWarning = ""
  )
  Clear-SetupScreen
  Write-Logo
  Write-ProfileBadge
  $cliCommand = if ($DbEnvironment -eq "development") { "execos" } else { "execos" }
  Write-Host "Install complete. Welcome to ExecOS." -ForegroundColor Green
  Write-Host ""
  Write-Host (Format-Bold "Installed here:") -ForegroundColor Cyan
  Write-Host "  $RepoRoot"
  Write-Host ""
  Write-Host (Format-Bold "Configuration:") -ForegroundColor Cyan
  Write-LabelLine "CLI" "$cliCommand ..."
  Write-LabelLine "Dashboard" "http://localhost:$DashboardPort"
  Write-LabelLine "Timezone" $Timezone
  Write-Host ""
  Write-Host (Format-Bold "Start with an agent:") -ForegroundColor Cyan
  Write-Host "  1. Open Claude Code or Codex in this folder. (Please Note that Claude Co-Work is not yet supported)."
  Write-Host "  2. Ask: open the dashboard"
  Write-Host "  3. Or ask: show me my active tasks"
  Write-Host "  4. Or ask: create a task for ..."
  Write-Host ""
  Write-Host (Format-Bold "Start from the terminal:") -ForegroundColor Cyan
  Write-Host "  $cliCommand dashboard start"
  Write-Host "  $cliCommand task list"
  if (-not [string]::IsNullOrWhiteSpace($CommandPublishWarning)) {
    Write-Host ""
    Write-Host (Format-Bold "Command publishing warning:") -ForegroundColor Yellow
    Write-Host "  $CommandPublishWarning"
    Write-Host "  To make 'execos' available globally on Windows, rerun the installer from an Administrator PowerShell"
    Write-Host "  or enable Windows Developer Mode, then rerun the installer."
  }
  Write-Host ""
  Write-Host (Format-Bold "Useful files:") -ForegroundColor Cyan
  Write-Host "  $EnvFileName - environment-specific secrets"
  Write-Host "  AGENTS.md    - materialized Codex instructions for this profile"
  Write-Host "  CLAUDE.md    - materialized Claude Code instructions for this profile"
  Write-Host ""
  Write-Host (Format-Bold "If something changes later:") -ForegroundColor Cyan
  Write-Host "  Edit $EnvFileName for dashboard port, timezone, or API keys."
  Write-Host "  Rerun this installer with -DbEnvironment $DbEnvironment to refresh this environment."
  Write-Host ""
  Write-Host (Format-Bold "Reporting bugs from chat:") -ForegroundColor Cyan
  if ($script:GitHubCliReady) {
    Write-Host "  Run this once to sign in to GitHub:"
    Write-Host "    gh auth login"
    Write-Host "  At the prompts pick: GitHub.com -> HTTPS -> Y -> Login with a web browser."
    Write-Host "  After that, just say 'report a bug' or 'this is broken' to your agent and"
    Write-Host "  it will file a GitHub issue for you."
  } else {
    Write-Host "  GitHub CLI (gh) was not installed automatically."
    Write-Host "  Install it from https://cli.github.com/ then run 'gh auth login' to enable"
    Write-Host "  bug reporting from chat. After that, just say 'report a bug' to your agent."
  }
  Write-Host ""
  Write-Host "You are ready." -ForegroundColor Green
}

function Write-LogTail {
  param(
    [string]$Path,
    [string]$Title
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host ""
    Write-Host $Title -ForegroundColor Yellow
    Write-Host "  Log file was not created: $Path"
    return
  }
  $lines = @(Get-Content -LiteralPath $Path -Tail 30)
  if ($lines.Count -eq 0) {
    Write-Host ""
    Write-Host $Title -ForegroundColor Yellow
    Write-Host "  Log file is empty: $Path"
    return
  }
  Write-Host ""
  Write-Host $Title -ForegroundColor Yellow
  foreach ($line in $lines) {
    Write-Host $line
  }
}

function Write-InstallFailure {
  param(
    [string]$Label,
    [int]$ExitCode,
    [string]$StdoutPath,
    [string]$StderrPath
  )
  Clear-SetupScreen
  Write-Logo
  Write-ProfileBadge
  Write-Host ""
  Write-Host "$Label failed with exit code $ExitCode." -ForegroundColor Red
  Write-Host "Full stdout log: $StdoutPath"
  Write-Host "Full stderr log: $StderrPath"
  Write-LogTail $StderrPath "Last stderr lines"
  Write-LogTail $StdoutPath "Last stdout lines"
  Write-Host ""
  Write-Host "Fix the issue above, then rerun the installer." -ForegroundColor Yellow
}

function Invoke-LoggedProcess {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [int]$Step,
    [int]$TotalSteps,
    [string]$WorkingDirectory = $RepoRoot,
    [switch]$AllowFailure
  )
  $stdoutPath = New-InstallLogPath $Label "stdout"
  $stderrPath = New-InstallLogPath $Label "stderr"
  $runnerPath = New-InstallRunnerPath $Label
  $spinnerFrames = @("|", "/", "-", "\")
  $startedAt = Get-Date
  $script:LastInstallStatusLength = 0

  if ($NoClearScreen) {
    Write-Step $Label
    Write-Host "Output log: $stdoutPath"
    Write-Host "Error log:  $stderrPath"
  } else {
    Write-InstallScreen $Label "Starting..." $Step $TotalSteps $stdoutPath $spinnerFrames[0]
  }

  $argumentLine = Join-ProcessArguments $ArgumentList
  $runnerLines = @(
    '$ErrorActionPreference = "Stop"',
    'try {',
    ('  $process = Start-Process -FilePath ' + (Format-PowerShellLiteral $FilePath) + ' -ArgumentList ' + (Format-PowerShellLiteral $argumentLine) + ' -WorkingDirectory ' + (Format-PowerShellLiteral $WorkingDirectory) + ' -RedirectStandardOutput ' + (Format-PowerShellLiteral $stdoutPath) + ' -RedirectStandardError ' + (Format-PowerShellLiteral $stderrPath) + ' -NoNewWindow -Wait -PassThru'),
    '} catch {',
    ('  $_ | Out-String | Set-Content -LiteralPath ' + (Format-PowerShellLiteral $stderrPath) + ' -Encoding UTF8'),
    '  exit 1',
    '}',
    'exit $process.ExitCode'
  )
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($runnerPath, $runnerLines, $utf8NoBom)

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo.FileName = "powershell"
  $process.StartInfo.Arguments = Join-ProcessArguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runnerPath)
  $process.StartInfo.WorkingDirectory = $WorkingDirectory
  $process.StartInfo.RedirectStandardOutput = $false
  $process.StartInfo.RedirectStandardError = $false
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $exitCode = 1

  try {
    [void]$process.Start()
    $frame = 0
    while (-not $process.HasExited) {
      Start-Sleep -Milliseconds 80
      $elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
      $spinner = $spinnerFrames[$frame % $spinnerFrames.Count]
      if ($NoClearScreen) {
        $line = "`r$spinner $Label ($elapsed sec)"
        try {
          [Console]::Write($line.PadRight([Math]::Max(1, [Console]::WindowWidth - 1)))
        } catch {
          Write-Host "$spinner $Label ($elapsed sec)"
        }
      } else {
        Write-InstallStatusLine $Label "Working... $elapsed sec" $spinner
      }
      $frame++
    }
    $process.WaitForExit()
    $exitCode = $process.ExitCode
  } finally {
    $process.Dispose()
    if ($NoClearScreen) {
      Write-Host ""
    }
  }

  if ($exitCode -ne 0) {
    if ($AllowFailure) {
      if ($NoClearScreen) {
        Write-Host "[warn] $Label failed with exit code $exitCode." -ForegroundColor Yellow
      } else {
        Write-InstallStatusLine $Label "Warning: failed with exit code $exitCode" "[warn]"
        Write-Host ""
      }
      return $false
    }
    $script:InstallFailed = $true
    $script:InstallFailureMessage = "$Label failed with exit code $exitCode."
    Write-InstallFailure $Label $exitCode $stdoutPath $stderrPath
    return $false
  }

  if ($NoClearScreen) {
    Write-Host "[ok] $Label" -ForegroundColor Green
  } else {
    $elapsedTotal = [int]((Get-Date) - $startedAt).TotalSeconds
    Write-InstallStatusLine $Label "Done in $elapsedTotal sec" "[ok]"
    Write-Host ""
  }
  return $true
}

function Invoke-NpmStep {
  param(
    [string]$Label,
    [string[]]$NpmArgs,
    [int]$Step,
    [int]$TotalSteps
  )
  Invoke-LoggedProcess `
    -Label $Label `
    -FilePath (Get-NpmCommandPath) `
    -ArgumentList $NpmArgs `
    -Step $Step `
    -TotalSteps $TotalSteps `
    -WorkingDirectory $RepoRoot
}

$resolvedDbEnvironment = Resolve-DbEnvironment $DbEnvironment $Profile
if ($resolvedDbEnvironment -eq "production" -and -not $SkipDatabase -and -not $AllowProductionDatabaseChanges) {
  throw "Refusing to run production database steps without -AllowProductionDatabaseChanges. Use -SkipDatabase to capture credentials or clone safely, then rerun with -AllowProductionDatabaseChanges only after clone verification passes."
}
# Classify the migration target for scripts/migrate.ts so production
# enforces a mandatory pre-migration backup (fail-closed) while the
# disposable dev database stays best-effort. Inherited by all child steps.
$env:EXECOS_DB_ENV = $resolvedDbEnvironment
if ($resolvedDbEnvironment -eq "production" -and $AllowProductionDatabaseChanges) {
  $env:EXECOS_ALLOW_PRODUCTION_MIGRATE = $script:ProductionMigrateAck
}
$envFileName = Get-EnvFileName $resolvedDbEnvironment
$envPath = Join-Path $RepoRoot $envFileName
$legacyEnvPath = Join-Path $RepoRoot ".env"
$tempEnvPath = Join-Path $RepoRoot "$envFileName.installing-$PID.tmp"
$script:InstallerDbEnvironmentLabel = $resolvedDbEnvironment
$script:InstallerEnvFileLabel = $envFileName

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "package.json"))) {
  throw "Repo root does not look like ExecOS: $RepoRoot"
}

Remove-OrphanTempEnvFiles -RepoRoot $RepoRoot -EnvFileName $envFileName -CurrentPid $PID

$profileScript = Join-Path $RepoRoot "scripts\apply-profile.ps1"
if (-not (Test-Path -LiteralPath $profileScript)) {
  throw "Profile script not found: $profileScript"
}

$installCommand = Get-InstallCommand $Profile $DbEnvironment

Require-Command "node" "Install Node.js LTS 20+ from https://nodejs.org/ and rerun this script."
Require-Command "npm" "npm should be installed with Node.js. Reinstall Node.js LTS if npm is missing."
Assert-NodeVersion
$script:GitHubCliReady = Ensure-GitHubCli

$existing = Read-ExistingEnv $envPath
$usedLegacyEnvDefaults = $false
if ($UseExistingCredentials -and $existing.Count -eq 0) {
  throw "Cannot update without $envFileName. Run scripts/install.ps1 once first, then rerun scripts/update.ps1."
}
if (-not $UseExistingCredentials -and $existing.Count -eq 0 -and (Test-Path -LiteralPath $legacyEnvPath)) {
  $existing = Read-ExistingEnv $legacyEnvPath
  $usedLegacyEnvDefaults = $true
}

if (-not $UseExistingCredentials) {
  Write-PendingInstallProfile `
    -RepoRoot $RepoRoot `
    -PromptProfile $Profile `
    -DbEnvironment $resolvedDbEnvironment `
    -InstallCommand $installCommand

  Write-Banner
}

$credentialContext = @(
  "If $envFileName already has a value, press Enter to keep it.",
  "Dashboard port defaults to 3737. Timezone defaults to America/Denver."
)
if ($usedLegacyEnvDefaults) {
  $credentialContext += "No $envFileName found; using legacy .env values as defaults for this run."
}

$envOrder = @(
  "EXECOS_DB_ENV",
  "SUPABASE_URL",
  "SUPABASE_PROJECT_NAME",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "DASHBOARD_PORT",
  "USER_DEFAULT_TIMEZONE"
)

$values = @{}
$values["EXECOS_DB_ENV"] = $resolvedDbEnvironment
$requiredCredentialKeys = @(
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "OPENAI_API_KEY"
)

if ($UseExistingCredentials) {
  $missingCredentialKeys = @()
  foreach ($key in $requiredCredentialKeys) {
    if (-not $existing.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$existing[$key])) {
      $missingCredentialKeys += $key
    } else {
      $values[$key] = [string]$existing[$key]
    }
  }
  if ($missingCredentialKeys.Count -gt 0) {
    throw "Cannot update because $envFileName is missing required value(s): $($missingCredentialKeys -join ', '). Run scripts/install.ps1 to repair credentials."
  }
} else {
  $credentialSteps = 7
  $supabaseProjectInput = Read-ConfigValue "SUPABASE_URL" "1. Supabase Project ID" $existing -Required -Help ($credentialContext + @(
    "",
    "Find the Project ID in Supabase: Project Settings -> General -> Project ID.",
    "Open: https://supabase.com/dashboard/projects",
    "Paste only the Project ID. The installer will write SUPABASE_URL=https://<project-id>.supabase.co.",
    "Example Project ID: abc123"
  )) -Step 1 -TotalSteps $credentialSteps
  $supabaseProjectId = Convert-SupabaseProjectInputToProjectId $supabaseProjectInput
  $values["SUPABASE_URL"] = Convert-SupabaseProjectInputToUrl $supabaseProjectInput
  $values["SUPABASE_PROJECT_NAME"] = Read-ConfigValue "SUPABASE_PROJECT_NAME" "2. Supabase project name" $existing -Help ($credentialContext + @(
    "",
    "Find the friendly project name in Supabase: Project Settings -> General -> Project name.",
    "This is only shown in the local dashboard environment tooltip."
  )) -Step 2 -TotalSteps $credentialSteps
  Write-SupabaseExtensionsScreen $supabaseProjectId 3 $credentialSteps
  $values["SUPABASE_SERVICE_ROLE_KEY"] = Read-ConfigValue "SUPABASE_SERVICE_ROLE_KEY" "4. Supabase secret/service-role key" $existing -Required -Secret -Help @(
    "Find it in Supabase: Project Settings -> API Keys -> Publishable and secret API keys.",
    "Open: https://supabase.com/dashboard/project/$supabaseProjectId/settings/api",
    "Copy the Secret key. It usually starts with sb_secret_. Legacy service_role keys also work.",
    "Jordan's CLI uses this for writes and storage uploads. Keep it private."
  ) -Step 4 -TotalSteps $credentialSteps
  $values["SUPABASE_ANON_KEY"] = Read-ConfigValue "SUPABASE_ANON_KEY" "5. Supabase publishable/anon key" $existing -Required -Secret -Help @(
    "Find it in Supabase: Project Settings -> API Keys -> Publishable and secret API keys.",
    "Open: https://supabase.com/dashboard/project/$supabaseProjectId/settings/api",
    "Copy the Publishable key. It usually starts with sb_publishable_. Legacy anon keys also work.",
    "The dashboard uses this for read-only views under RLS."
  ) -Step 5 -TotalSteps $credentialSteps
  $values["DATABASE_URL"] = Read-ConfigValue "DATABASE_URL" "6. Supabase DATABASE_URL" $existing -Required -Secret -Help @(
    "Copy DATABASE_URL from Supabase: Connect -> ORM -> Drizzle -> Configure ORM -> .env.",
    "It starts with postgresql:// and includes the username, password, host, port, and database.",
    "Paste only the full URL value, without DATABASE_URL= or quotes. Replace [YOUR-PASSWORD] before pasting."
  ) -Normalize ${function:Convert-DatabaseUrlInput} -Step 6 -TotalSteps $credentialSteps
  $values["OPENAI_API_KEY"] = Read-ConfigValue "OPENAI_API_KEY" "7. OpenAI API key" $existing -Required -Secret -Help @(
    "Used only by Jordan's embedding adapter for memory retrieval.",
    "Open: https://platform.openai.com/api-keys",
    "It starts with sk-."
  ) -Step 7 -TotalSteps $credentialSteps
}
if (-not $values.ContainsKey("SUPABASE_PROJECT_NAME") -or [string]::IsNullOrWhiteSpace([string]$values["SUPABASE_PROJECT_NAME"])) {
  $values["SUPABASE_PROJECT_NAME"] = Get-ExistingOrDefault "SUPABASE_PROJECT_NAME" $existing ""
}
$values["DASHBOARD_PORT"] = Get-ExistingOrDefault "DASHBOARD_PORT" $existing "3737"
$values["USER_DEFAULT_TIMEZONE"] = Get-ExistingOrDefault "USER_DEFAULT_TIMEZONE" $existing "America/Denver"

Clear-SetupScreen
Write-Logo
Write-ProfileBadge
Write-Host ""
Write-Host (Format-Bold "Using defaults") -ForegroundColor Cyan
if ($UseExistingCredentials) {
  Write-Host "  Using existing credentials from $envFileName. No credential prompts will be shown."
}
Write-LabelLine "Dashboard port" $($values["DASHBOARD_PORT"])
Write-LabelLine "Timezone" $($values["USER_DEFAULT_TIMEZONE"])
Write-Host "  To change these later, edit $envFileName and rerun the command."
$dashboardPortNumber = 0
if ([int]::TryParse([string]$values["DASHBOARD_PORT"], [ref]$dashboardPortNumber)) {
  if (Test-LocalTcpPortOpen $dashboardPortNumber) {
    Write-Host ""
    Write-Host "Warning: something is already listening on dashboard port $dashboardPortNumber." -ForegroundColor Yellow
    Write-Host "If it is not an existing ExecOS dashboard, change DASHBOARD_PORT in $envFileName after setup."
  }
}

try {
  Write-Step "Writing temporary environment file"
  Write-RepoEnv $tempEnvPath $values $envOrder
  Set-RestrictiveAcl $tempEnvPath
  Write-Host "Temporary env file created for validation. It will be deleted after setup."

  $nodePath = (Get-Command "node" -ErrorAction Stop).Source
  $npmPath = Get-NpmCommandPath
  $dashboardStopAttempted = $false
  $installSteps = @()
  $installSteps += @{
    Label = "Validating Supabase API credentials"
    FilePath = $nodePath
    Args = @("scripts/run-with-env.cjs", $tempEnvPath, "node", "scripts/check-connection.cjs")
  }
  $installSteps += @{
    Label = "Validating OpenAI API key"
    FilePath = $nodePath
    Args = @("scripts/run-with-env.cjs", $tempEnvPath, "node", "scripts/check-openai.cjs")
  }
  if (-not $SkipInstall) {
    $installSteps += @{
      Label = "Installing npm dependencies"
      FilePath = $npmPath
      Args = @("--prefix", $RepoRoot, "ci")
    }
  }
  if (-not $SkipBuild) {
    $installSteps += @{
      Label = "Building TypeScript"
      FilePath = $npmPath
      Args = @("--prefix", $RepoRoot, "run", "build")
    }
    $installSteps += @{
      Label = "Building web dashboard"
      FilePath = $nodePath
      Args = @("scripts/run-with-env.cjs", $tempEnvPath, "node", "node_modules/vite/bin/vite.js", "build")
    }
  }
  if (-not $SkipDatabase) {
    $installSteps += @{
      Label = "Checking Postgres connection and extensions"
      FilePath = $nodePath
      Args = @("scripts/run-with-env.cjs", $tempEnvPath, "node", "scripts/check-postgres.cjs")
    }
    $installSteps += @{
      Label = "Running pending migrations"
      FilePath = $nodePath
      Args = @("scripts/run-with-env.cjs", $tempEnvPath, "node", "--import=tsx", "scripts/migrate.ts", "up")
    }
    $installSteps += @{
      Label = "Seeding app settings"
      FilePath = $nodePath
      Args = @("scripts/run-with-env.cjs", $tempEnvPath, "node", "--import=tsx", "scripts/seed-app-settings.ts")
    }
    $installSteps += @{
      Label = "Backfilling task embeddings"
      FilePath = $nodePath
      Args = @("scripts/run-with-env.cjs", $tempEnvPath, "node", "--import=tsx", "scripts/backfill-task-embeddings.ts", "--strict")
    }
  }

  $healthArgs = @("scripts/run-with-env.cjs", $tempEnvPath, "node", "--import=tsx", "src/cli/index.ts", "health")
  $installSteps += @{
    Label = "Running health check"
    FilePath = $nodePath
    Args = $healthArgs
  }
  $installSteps += @{
    Label = "Publishing execos command"
    FilePath = $npmPath
    Args = @("link")
  }

  $installStepNumber = 1
  foreach ($step in $installSteps) {
    if (
      -not $dashboardStopAttempted -and
      (
        [string]$step.Label -ne "Validating Supabase API credentials" -and
        [string]$step.Label -ne "Validating OpenAI API key"
      )
    ) {
      $dashboardStopAttempted = $true
      [void](Stop-DashboardForInstall `
        -NodePath $nodePath `
        -RepoRoot $RepoRoot `
        -EnvPath $tempEnvPath `
        -ResolvedDbEnvironment $resolvedDbEnvironment `
        -DashboardPort $dashboardPortNumber)
    }

    $stepLabel = [string]$step.Label
    $allowStepFailure = $stepLabel -eq "Publishing execos command"
    $stepOk = Invoke-LoggedProcess `
      -Label $stepLabel `
      -FilePath ([string]$step.FilePath) `
      -ArgumentList ([string[]]$step.Args) `
      -Step $installStepNumber `
      -TotalSteps $installSteps.Count `
      -WorkingDirectory $RepoRoot `
      -AllowFailure:$allowStepFailure
    if (-not $stepOk -and $allowStepFailure) {
      $script:CommandPublishWarning = "'npm link' could not publish the global 'execos' command. Setup continued, but 'execos' may not work in a new terminal yet."
      $installStepNumber++
      continue
    }
    if (-not $stepOk) {
      break
    }
    $installStepNumber++
  }

  if (-not $script:InstallFailed) {
    if ($UseExistingCredentials) {
      Write-Step "Keeping existing environment file"
      Write-Host "$envFileName was reused without rewriting credentials."
    } else {
      Write-Step "Writing repo-local environment files"
      $backupPath = Backup-ExistingEnv $envPath
      if ($backupPath) {
        Write-Host "Existing $envFileName backed up to $backupPath"
      }
      Write-RepoEnvAtomically $envPath $values $envOrder
      Set-RestrictiveAcl $envPath
      Write-Host "$envFileName written at $envPath"
      if ($usedLegacyEnvDefaults) {
        try {
          $legacyBackupPath = Move-LegacyEnvAfterMigration $legacyEnvPath
          if ($legacyBackupPath) {
            Write-Host "Legacy .env moved to $legacyBackupPath"
          }
        } catch {
          Write-Host "Warning: could not move legacy .env after migration: $($_.Exception.Message)" -ForegroundColor Yellow
        }
      }
    }

    Set-ExecosLiveTarget $nodePath $resolvedDbEnvironment

    $linkedCommandName = if ($resolvedDbEnvironment -eq "development") { "execos" } else { "execos" }
    Ensure-ExecosCommandOnPath $npmPath $linkedCommandName

    [void](Invoke-LoggedProcess `
      -Label "Applying final profile" `
      -FilePath (Get-Command "powershell" -ErrorAction Stop).Source `
      -ArgumentList @("-ExecutionPolicy", "Bypass", "-NoProfile", "-File", $profileScript, "-Profile", $Profile, "-RepoRoot", $RepoRoot) `
      -Step 1 `
      -TotalSteps 1 `
      -WorkingDirectory $RepoRoot)

    Start-DashboardAfterInstall `
      -NodePath $nodePath `
      -RepoRoot $RepoRoot `
      -EnvPath $envPath `
      -ResolvedDbEnvironment $resolvedDbEnvironment
  }
} catch {
  $script:InstallFailed = $true
  $script:InstallFailureMessage = $_.Exception.Message
  Clear-SetupScreen
  Write-Logo
  Write-ProfileBadge
  Write-Host ""
  Write-Host "Install failed." -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host ""
  Write-Host "Fix the issue above, then rerun the installer." -ForegroundColor Yellow
} finally {
  Remove-IfExists $tempEnvPath
}

if ($script:InstallFailed) {
  exit 1
}

Write-WelcomeScreen `
  -RepoRoot $RepoRoot `
  -Profile $Profile `
  -DbEnvironment $resolvedDbEnvironment `
  -EnvFileName $envFileName `
  -DashboardPort ([string]$values["DASHBOARD_PORT"]) `
  -Timezone ([string]$values["USER_DEFAULT_TIMEZONE"]) `
  -CommandPublishWarning $script:CommandPublishWarning
