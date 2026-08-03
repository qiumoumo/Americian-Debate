[CmdletBinding()]
param(
  [switch]$SetupOnly,
  [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$script:ProjectRoot = Split-Path -Parent $PSScriptRoot
$script:AppUrl = "http://127.0.0.1:3000"

try {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch {
  # Older hosts can still run the setup even if console encoding is immutable.
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Notice {
  param([string]$Message)
  Write-Host "    $Message" -ForegroundColor DarkGray
}

function Invoke-Checked {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  Write-Step $Label
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed (exit code $LASTEXITCODE)."
  }
}

function Get-CommandPath {
  param([string[]]$Names)
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and $command.Source) {
      return $command.Source
    }
  }
  return $null
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = @($machinePath, $userPath) -join ";"
}

function Get-NodeVersion {
  param([string]$NodePath)
  $version = (& $NodePath -p "process.versions.node").Trim()
  if ($LASTEXITCODE -ne 0 -or $version -notmatch "^(\d+)\.") {
    throw "The installed Node.js version could not be read."
  }
  return [PSCustomObject]@{
    Text = $version
    Major = [int]$Matches[1]
  }
}

function Install-Node22 {
  Write-Step "Node.js 22+ was not found; downloading the latest Node.js 22 LTS installer"
  Write-Notice "Windows may show a User Account Control prompt. Choose Yes to continue."

  $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $installerPath = $null
  try {
    $releases = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 30
    $release = $releases |
      Where-Object { $_.version -match "^v22\." -and $_.files -contains "win-$architecture-msi" } |
      Select-Object -First 1
    if (-not $release) {
      throw "No compatible Node.js 22 MSI was listed for $architecture."
    }

    $fileName = "node-$($release.version)-$architecture.msi"
    $downloadUrl = "https://nodejs.org/dist/$($release.version)/$fileName"
    $checksumUrl = "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt"
    $installerPath = Join-Path ([IO.Path]::GetTempPath()) "american-debate-$fileName"

    if (Test-Path -LiteralPath $installerPath) {
      Remove-Item -LiteralPath $installerPath -Force
    }
    Invoke-WebRequest -Uri $downloadUrl -OutFile $installerPath -UseBasicParsing -TimeoutSec 300
    $checksums = (Invoke-WebRequest -Uri $checksumUrl -UseBasicParsing -TimeoutSec 30).Content
    $escapedName = [regex]::Escape($fileName)
    $match = [regex]::Match($checksums, "(?m)^([a-fA-F0-9]{64})\s+\*?$escapedName\s*$")
    if (-not $match.Success) {
      throw "The official checksum for $fileName could not be found."
    }

    $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
    if ($actualHash -ne $match.Groups[1].Value) {
      throw "The Node.js installer checksum did not match; the downloaded file was not run."
    }

    $process = Start-Process -FilePath "msiexec.exe" `
      -ArgumentList @("/i", "`"$installerPath`"", "/passive", "/norestart") `
      -Verb RunAs -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) {
      throw "The Node.js installer exited with code $($process.ExitCode)."
    }
  } catch {
    throw "Automatic Node.js installation failed: $($_.Exception.Message) Download Node.js 22 LTS from https://nodejs.org/en/download and run this file again."
  } finally {
    if ($installerPath -and (Test-Path -LiteralPath $installerPath)) {
      Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
    }
  }

  Refresh-ProcessPath
}

function Resolve-Node {
  $nodePath = Get-CommandPath @("node.exe", "node")
  if ($nodePath) {
    $version = Get-NodeVersion $nodePath
    if ($version.Major -ge 22) {
      Write-Notice "Node.js $($version.Text) detected at $nodePath"
      if ($version.Major -gt 24) {
        Write-Warning "This project is tested with Node.js 22 and 24. Node.js $($version.Text) may not be compatible."
      }
      return $nodePath
    }
    Write-Notice "Node.js $($version.Text) is too old for this project."
  }

  Install-Node22
  $nodePath = Get-CommandPath @("node.exe", "node")
  if (-not $nodePath) {
    $defaultNodePath = Join-Path $env:ProgramFiles "nodejs\node.exe"
    if (Test-Path -LiteralPath $defaultNodePath) {
      $nodePath = $defaultNodePath
      $env:Path = "$(Split-Path -Parent $nodePath);$env:Path"
    }
  }
  if (-not $nodePath) {
    throw "Node.js was installed but is not available. Restart Windows, then run this file again."
  }

  $version = Get-NodeVersion $nodePath
  if ($version.Major -lt 22) {
    throw "Node.js 22+ is required, but version $($version.Text) is active."
  }
  Write-Notice "Node.js $($version.Text) is ready."
  return $nodePath
}

function Resolve-Corepack {
  $corepackPath = Get-CommandPath @("corepack.cmd", "corepack")
  if ($corepackPath) {
    return $corepackPath
  }

  Write-Step "Corepack was not found; installing it for the current Windows user"
  $npmPath = Get-CommandPath @("npm.cmd", "npm")
  if (-not $npmPath) {
    throw "npm was not found next to Node.js. Reinstall Node.js 22 LTS and run this file again."
  }
  $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
  $toolsRoot = Join-Path $localAppData "AmericanDebate\tools"
  & $npmPath install --prefix $toolsRoot corepack@0.35.0 --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    throw "Corepack could not be installed. Check the network connection and run this file again."
  }
  $toolsBin = Join-Path $toolsRoot "node_modules\.bin"
  $env:Path = "$toolsBin;$env:Path"
  $corepackPath = Join-Path $toolsBin "corepack.cmd"
  if (-not (Test-Path -LiteralPath $corepackPath)) {
    throw "Corepack installation completed but corepack.cmd was not found."
  }
  return $corepackPath
}

function New-RandomHex {
  param([int]$ByteCount = 32)
  $bytes = New-Object byte[] $ByteCount
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Get-EnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path -LiteralPath $Path)) {
    return ""
  }
  $escapedKey = [regex]::Escape($Key)
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match "^\s*$escapedKey\s*=\s*(.*)$") {
      return $Matches[1].Trim().Trim("'", '"')
    }
  }
  return ""
}

function Set-EnvValue {
  param([string]$Path, [string]$Key, [string]$Value)
  $lines = if (Test-Path -LiteralPath $Path) { @([IO.File]::ReadAllLines($Path)) } else { @() }
  $escapedKey = [regex]::Escape($Key)
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match "^\s*$escapedKey\s*=") {
      $lines[$index] = "$Key=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) {
    $lines += "$Key=$Value"
  }
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, (($lines -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine), $encoding)
}

function Ensure-EnvValue {
  param(
    [string]$Path,
    [string]$Key,
    [string]$DefaultValue,
    [string[]]$ReplaceValues = @()
  )
  $current = Get-EnvValue $Path $Key
  if (-not $current -or $ReplaceValues -contains $current) {
    Set-EnvValue $Path $Key $DefaultValue
  }
}

function Initialize-LocalEnvironment {
  Write-Step "Preparing local configuration"
  $envPath = Join-Path $script:ProjectRoot ".env.local"
  if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath (Join-Path $script:ProjectRoot ".env.example") -Destination $envPath
    Write-Notice "Created .env.local from the safe example."
  }

  Ensure-EnvValue $envPath "AI_PROVIDER" "mock"
  Ensure-EnvValue $envPath "DATABASE_URL" "file:./dev-mvp.db"
  Ensure-EnvValue $envPath "COOKIE_SECURE" "false"
  Ensure-EnvValue $envPath "AI_ALLOW_PRIVATE_ENDPOINTS" "false"
  Ensure-EnvValue $envPath "NO_PROXY" "localhost,127.0.0.1"
  Ensure-EnvValue $envPath "SESSION_SECRET" (New-RandomHex 32) @("change-this-local-secret")
  Ensure-EnvValue $envPath "APP_ENCRYPTION_KEY" (New-RandomHex 32)
  Ensure-EnvValue $envPath "SEED_ADMIN_EMAIL" "admin@debate.local"
  Ensure-EnvValue $envPath "SEED_ADMIN_NAME" "Admin"
  Ensure-EnvValue $envPath "SEED_ADMIN_PASSWORD" ("Debate-" + (New-RandomHex 12))

  # Local one-click deployments explicitly unlock the existing server-side model list probe.
  Set-EnvValue $envPath "AI_MODEL_DISCOVERY_ENABLED" "true"

  Write-Notice "AI model discovery is enabled. Existing provider URLs and API keys were preserved."
  return $envPath
}

function Test-TcpPort {
  param([string]$HostName, [int]$Port)
  $client = New-Object Net.Sockets.TcpClient
  try {
    $connection = $client.BeginConnect($HostName, $Port, $null, $null)
    return $connection.AsyncWaitHandle.WaitOne(500, $false) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-DebateAppRunning {
  try {
    $response = Invoke-WebRequest -Uri $script:AppUrl -UseBasicParsing -TimeoutSec 3
    return $response.Content -match "Debate Suite"
  } catch {
    return $false
  }
}

function Test-NodeOutboundHttps {
  param([string]$NodePath)
  Write-Step "Checking Node.js outbound HTTPS for AI model discovery"
  $probe = @"
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10000);
fetch('https://registry.npmjs.org/-/ping', { signal: controller.signal })
  .then((response) => { clearTimeout(timer); process.exit(response.ok ? 0 : 2); })
  .catch(() => process.exit(1));
"@
  & $NodePath -e $probe
  if ($LASTEXITCODE -eq 0) {
    Write-Notice "Node.js can access public HTTPS endpoints."
  } else {
    Write-Warning "Node.js outbound HTTPS is blocked. Setup can continue, but AI model detection may fail. Allow Node.js outbound TCP 443 or configure HTTPS_PROXY in .env.local."
  }
}

function Show-LoginDetails {
  param([string]$EnvPath)
  $email = Get-EnvValue $EnvPath "SEED_ADMIN_EMAIL"
  $password = Get-EnvValue $EnvPath "SEED_ADMIN_PASSWORD"
  Write-Host ""
  Write-Host "Setup complete." -ForegroundColor Green
  Write-Host "URL:      $script:AppUrl"
  Write-Host "Account:  $email"
  Write-Host "Password: $password"
  Write-Host "AI models: enabled; configure a provider after login under Admin > AI."
  Write-Host "Close this window to stop the server." -ForegroundColor Yellow
}

function Start-DebateApp {
  param([string]$CorepackPath, [string]$EnvPath)
  if (Test-DebateAppRunning) {
    Write-Notice "American Debate is already running; opening it in the browser."
    Start-Process $script:AppUrl
    return
  }
  if (Test-TcpPort "127.0.0.1" 3000) {
    throw "Port 3000 is already used by another program. Close that program, then run this file again."
  }

  Show-LoginDetails $EnvPath
  $watcherPath = Join-Path $PSScriptRoot "open-when-ready.ps1"
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$watcherPath`"", "-Url", $script:AppUrl
  )
  Invoke-Checked "Starting American Debate" $CorepackPath @("pnpm", "--filter", "@debate/web", "start")
}

function Main {
  Set-Location $script:ProjectRoot
  if (-not (Test-Path -LiteralPath (Join-Path $script:ProjectRoot "package.json")) -or
      -not (Test-Path -LiteralPath (Join-Path $script:ProjectRoot "pnpm-workspace.yaml"))) {
    throw "Project files are incomplete. Put this launcher in the repository root and download the complete ZIP again."
  }

  Write-Host "American Debate - one-click Windows setup" -ForegroundColor White
  Write-Notice "Project: $script:ProjectRoot"
  $nodePath = Resolve-Node
  $corepackPath = Resolve-Corepack

  if ($CheckOnly) {
    Write-Step "Launcher check passed"
    Write-Notice "Node.js and Corepack are available; no files were changed."
    return
  }

  if (Test-DebateAppRunning) {
    Write-Notice "American Debate is already running; opening it in the browser."
    Start-Process $script:AppUrl
    return
  }
  if (Test-TcpPort "127.0.0.1" 3000) {
    throw "Port 3000 is already used by another program. Close that program, then run this file again."
  }

  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
  Invoke-Checked "Activating pnpm 9.15.0" $corepackPath @("prepare", "pnpm@9.15.0", "--activate")
  $envPath = Initialize-LocalEnvironment
  Invoke-Checked "Installing project dependencies" $corepackPath @("pnpm", "install", "--frozen-lockfile", "--prefer-offline")
  Invoke-Checked "Generating the database client" $corepackPath @("pnpm", "--filter", "@debate/db", "prisma:generate")
  Invoke-Checked "Creating or updating the local database" $corepackPath @("pnpm", "--filter", "@debate/db", "prisma:push")
  Invoke-Checked "Creating the local owner account and sample data" $corepackPath @("pnpm", "--filter", "@debate/db", "prisma:seed")
  Invoke-Checked "Updating saved AI configuration data" $corepackPath @("pnpm", "--filter", "@debate/db", "ai:backfill")
  Invoke-Checked "Updating match report data" $corepackPath @("pnpm", "--filter", "@debate/db", "reports:backfill")
  Invoke-Checked "Updating room data" $corepackPath @("pnpm", "--filter", "@debate/db", "rooms:backfill")
  Test-NodeOutboundHttps $nodePath
  Invoke-Checked "Building the production application" $corepackPath @("pnpm", "--filter", "@debate/web", "build")

  if ($SetupOnly) {
    Show-LoginDetails $envPath
    Write-Notice "Setup-only mode selected; the server was not started."
    return
  }
  Start-DebateApp $corepackPath $envPath
}

$exitCode = 0
try {
  Main
} catch {
  $exitCode = 1
  $logPath = Join-Path $script:ProjectRoot ".one-click-setup.log"
  $logLine = "[{0}] {1}{2}" -f (Get-Date -Format "s"), $_.Exception.Message, [Environment]::NewLine
  [IO.File]::AppendAllText($logPath, $logLine, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ""
  Write-Host "Setup stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $logPath" -ForegroundColor Yellow
}

exit $exitCode
