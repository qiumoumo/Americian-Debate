param(
  [Parameter(Mandatory = $true)]
  [string]$Url,
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "SilentlyContinue"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Start-Process $Url
      exit 0
    }
  } catch {
    # The production server is still starting.
  }
  Start-Sleep -Seconds 1
}

exit 1
