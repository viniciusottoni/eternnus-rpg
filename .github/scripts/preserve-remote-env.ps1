param(
  [Parameter(Mandatory = $true)][string]$PackageWebConfig,
  # Optional local copy of the server web.config. When omitted, it is downloaded via FTPS.
  [string]$RemoteWebConfig = '',
  [string]$RemoteDir = $env:FTP_SERVER_DIR
)
$ErrorActionPreference = "Stop"

# The SmarterASP control panel stores the app's environment variables (connection string, SMTP,
# PublicUrl...) inside <aspNetCore><environmentVariables> of the server web.config. The package
# ships a generated web.config, so without this merge every deploy erased the production settings
# and the process failed to start (HTTP 502.5). Values are never printed.
$downloaded = $false
if (-not $RemoteWebConfig) {
  foreach ($key in @('SMARTERASP_FTP_SERVER', 'SMARTERASP_FTP_USERNAME', 'SMARTERASP_FTP_PASSWORD')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) { throw "Missing $key" }
  }
  $RemoteWebConfig = Join-Path ([IO.Path]::GetTempPath()) ("remote-web-" + [guid]::NewGuid() + ".config")
  $remote = $RemoteDir.Substring(2) + 'web.config'
  & curl.exe --ssl-reqd --silent --show-error --connect-timeout 30 --retry 3 --retry-delay 5 `
    --user "$($env:SMARTERASP_FTP_USERNAME):$($env:SMARTERASP_FTP_PASSWORD)" `
    --output $RemoteWebConfig "ftp://$($env:SMARTERASP_FTP_SERVER)/$remote"
  # 78 = remote file not found (first deploy). Any other failure stops the deploy instead of
  # silently replacing the server settings.
  if ($LASTEXITCODE -eq 78) {
    Write-Host 'No web.config on the server yet; nothing to preserve.'
    return
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not download the server web.config (curl exit $LASTEXITCODE)" }
  $downloaded = $true
}
try {
  if (-not (Test-Path $RemoteWebConfig)) { Write-Host 'No server web.config; nothing to preserve.'; return }
  $remoteXml = New-Object System.Xml.XmlDocument
  $remoteXml.PreserveWhitespace = $false
  $remoteXml.Load((Resolve-Path $RemoteWebConfig).Path)
  $vars = $remoteXml.SelectSingleNode('//aspNetCore/environmentVariables')
  $count = if ($vars) { @($vars.SelectNodes('environmentVariable')).Count } else { 0 }
  if ($count -eq 0) {
    Write-Host '::warning::The server web.config has no environment variables. Configure production settings in the SmarterASP panel.'
    return
  }
  $package = (Resolve-Path $PackageWebConfig).Path
  $local = New-Object System.Xml.XmlDocument
  $local.Load($package)
  $aspNetCore = $local.SelectSingleNode('//aspNetCore')
  if (-not $aspNetCore) { throw 'Package web.config has no aspNetCore element' }
  $existing = $aspNetCore.SelectSingleNode('environmentVariables')
  if ($existing) { [void]$aspNetCore.RemoveChild($existing) }
  [void]$aspNetCore.AppendChild($local.ImportNode($vars, $true))
  $local.Save($package)
  $names = @($vars.SelectNodes('environmentVariable') | ForEach-Object { $_.GetAttribute('name') }) -join ', '
  Write-Host "Preserved $count server environment variable(s) (values hidden): $names"
}
finally {
  if ($downloaded) { Remove-Item $RemoteWebConfig -Force -ErrorAction SilentlyContinue }
}
