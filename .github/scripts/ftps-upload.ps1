param(
  [Parameter(Mandatory = $true)][string]$LocalDir,
  # Same format validated by the workflow: "./" or "./folder/".
  [Parameter(Mandatory = $true)][string]$RemoteDir,
  # Relative paths (forward slashes) that are uploaded by other steps.
  [string[]]$Exclude = @('app_offline.htm'),
  [int]$BatchSize = 40,
  [int]$Attempts = 3
)
$ErrorActionPreference = "Stop"

# Explicit FTPS upload with curl.exe, the same client that already publishes app_offline.htm
# to this server. One curl process per batch reuses the control connection; a failed batch is
# retried as a whole because uploads overwrite and are therefore idempotent.
# Never deletes remote files: App_Data, keys and other server-side state stay untouched.
foreach ($key in @('SMARTERASP_FTP_SERVER', 'SMARTERASP_FTP_USERNAME', 'SMARTERASP_FTP_PASSWORD')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) { throw "Missing $key" }
}
if ($RemoteDir -notmatch '^\./(?:[A-Za-z0-9_.-]+/)*$' -or $RemoteDir -match '(^|/)\.\.(/|$)') {
  throw "Invalid remote directory: $RemoteDir"
}

$root = (Resolve-Path $LocalDir).Path.TrimEnd('\', '/')
$prefix = $RemoteDir.Substring(2)
$server = $env:SMARTERASP_FTP_SERVER
$files = @(Get-ChildItem $root -File -Recurse | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    if ($Exclude -notcontains $relative) {
      [pscustomobject]@{ Local = $_.FullName.Replace('\', '/'); Relative = $relative; Length = $_.Length }
    }
  })
if ($files.Count -eq 0) { throw "Nothing to upload from $LocalDir" }
foreach ($file in $files) {
  if ($file.Local.Contains('"') -or $file.Relative -match '[\x00-\x1f]') { throw "Unsupported file name: $($file.Relative)" }
}
$totalMb = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "Uploading $($files.Count) files ($totalMb MB) to $RemoteDir"

$batches = [math]::Ceiling($files.Count / $BatchSize)
$config = Join-Path ([IO.Path]::GetTempPath()) ("ftps-upload-" + [guid]::NewGuid() + ".txt")
try {
  for ($batch = 0; $batch -lt $batches; $batch++) {
    $slice = $files | Select-Object -Skip ($batch * $BatchSize) -First $BatchSize
    $lines = foreach ($file in $slice) {
      $remote = ($prefix + $file.Relative).Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }
      "upload-file = `"$($file.Local)`""
      "url = `"ftp://$server/$($remote -join '/')`""
    }
    Set-Content -Path $config -Value $lines -Encoding utf8NoBOM
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
      Write-Host "Batch $($batch + 1)/$batches ($(@($slice).Count) files), attempt $attempt/$Attempts"
      & curl.exe --ssl-reqd --ftp-create-dirs --fail-early --silent --show-error `
        --connect-timeout 30 --retry 3 --retry-delay 5 --retry-all-errors `
        --user "$($env:SMARTERASP_FTP_USERNAME):$($env:SMARTERASP_FTP_PASSWORD)" `
        --config $config
      if ($LASTEXITCODE -eq 0) { break }
      if ($attempt -eq $Attempts) { throw "FTPS batch $($batch + 1) failed after $Attempts attempts (curl exit $LASTEXITCODE)" }
      Start-Sleep -Seconds (15 * $attempt)
    }
  }
}
finally {
  Remove-Item $config -Force -ErrorAction SilentlyContinue
}
Write-Host "FTPS upload complete: $($files.Count) files"
