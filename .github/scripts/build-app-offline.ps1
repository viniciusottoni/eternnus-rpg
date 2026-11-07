param(
  [string]$SiteRoot = "apps/Eternnus.Web/wwwroot",
  [string]$Output = "artifacts/ftp-publish/app_offline.htm"
)
$ErrorActionPreference = "Stop"

# ANCM's app_offline.htm replaces ALL responses (including CSS/images) while IIS shuts
# down the ASP.NET Core process. Therefore this must be a truly standalone page.
$index = Get-Content (Join-Path $SiteRoot "index.html") -Raw -Encoding UTF8
$styles = Get-Content (Join-Path $SiteRoot "styles.css") -Raw -Encoding UTF8
$game = Get-Content (Join-Path $SiteRoot "game.css") -Raw -Encoding UTF8
$match = [regex]::Match($index, '(?s)<section\s+id="splash".*?</section>')
if (-not $match.Success) { throw "Cannot find the canonical Eternnus splash in index.html" }
$splash = $match.Value
if (-not $splash.Contains('src="/assets/eternnus-logo.webp"')) {
  throw "Canonical splash logo not found; update the offline generator to match it."
}
$logo = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path (Join-Path $SiteRoot "assets/eternnus-logo.webp")).Path))
$valley = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path (Join-Path $SiteRoot "assets/valley.webp")).Path))
$splash = $splash.Replace('src="/assets/eternnus-logo.webp"', 'src="data:image/webp;base64,' + $logo + '"')
$splash = $splash.Replace('Carregando sua mesa…', 'Atualizando sua mesa…')
$splash = $splash.Replace('O próximo capítulo está prestes a começar.', 'Sua jornada continua após a atualização.')
$styles = $styles.Replace('url("/assets/valley.webp")', 'url("data:image/webp;base64,' + $valley + '")')
$game = $game.Replace('url("/assets/valley.webp")', 'url("data:image/webp;base64,' + $valley + '")')
if ($styles.Contains('</style>') -or $game.Contains('</style>')) { throw "Unsafe CSS closing style tag" }
$html = @"
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#111110">
  <meta http-equiv="Cache-Control" content="no-store">
  <meta name="eternnus-deployment" content="ETERNNUS_DEPLOYMENT_OFFLINE">
  <title>Eternnus RPG — Atualização em andamento</title>
  <style>
$game
$styles
  /* Keep the existing loading animation active for deployments longer than 3 s. */
  .opening-progress span { animation: opening-progress 3s ease-in-out infinite alternate; }
  @media (prefers-reduced-motion: reduce) { .opening-progress span { animation: none; transform: scaleX(1); } }
  </style>
</head>
<body>
  <div class="atmosphere" aria-hidden="true">
    <div class="mist mist-one"></div><div class="mist mist-two"></div>
    <span class="ember ember-one"></span><span class="ember ember-two"></span><span class="ember ember-three"></span>
  </div>
  $splash
  <script>
  (() => {
    // Do not restore an active SPA using this page: it is only for NEW requests.
    // The active tab uses maintenance.js and retains its unsaved DOM state.
    let reloading = false;
    async function retry() {
      if (reloading || !navigator.onLine) return;
      try {
        const response = await fetch('/health?deploy-check=' + Date.now(), {
          cache: 'no-store', credentials: 'same-origin'
        });
        if (response.ok) {
          const body = await response.json();
          if (body.status === 'ok') {
            reloading = true;
            location.reload();
          }
        }
      } catch { /* IIS still deploying; retry on next tick. */ }
    }
    setInterval(retry, 5000);
    setTimeout(retry, 5000);
  })();
  </script>
</body>
</html>
"@
$parent = Split-Path -Parent $Output
New-Item -ItemType Directory -Force -Path $parent | Out-Null
[IO.File]::WriteAllText((Join-Path (Resolve-Path $parent).Path (Split-Path -Leaf $Output)), $html, [Text.UTF8Encoding]::new($false))
if (-not $html.Contains('ETERNNUS_DEPLOYMENT_OFFLINE') -or -not $html.Contains('data:image/webp;base64,')) {
  throw "Invalid app_offline.htm output"
}
Write-Host "Created standalone Eternnus offline screen from current splash and brand assets."
