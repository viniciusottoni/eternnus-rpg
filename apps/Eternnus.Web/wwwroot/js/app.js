import { installLoading, endOpening, withLoading } from "./loading.js";
import { installMaintenanceWatcher } from "./maintenance.js";
import { installMusic } from "./music.js";
import { state } from "./state.js";
import { installPwa } from "./pwa.js";
import { installHelp } from "./help.js";
import { api, renewCsrf, clearCsrf } from "./api.js";
import { $, esc, button, toast, installUi } from "./ui.js";
import { renderAuth, refreshUser, installAuth, takeReturnRoute } from "./auth.js";
import { renderHome, shell, installNavMore } from "./layout.js";
import { renderCampaigns, installCampaigns } from "./campaigns.js";
import { canAccess, openingDeadline, PLATFORM_ROUTES, isSafeSegment, canOpenPlatform, safeReturnRoute, isInviteCode } from "./policy.js";
import { parseRoute, isGuid } from "./session-policy.js";
const started = performance.now();
let opening = true,
  bootError = null,
  bootReady = false,
  routeVersion = 0,
  dispose = null;
installLoading();
installMaintenanceWatcher();
// A trilha tenta começar já durante a abertura; o navegador pode exigir o primeiro gesto.
installMusic();
installUi();
installHelp();
installAuth();
installCampaigns();
installPwa();
installNavMore();
const requestedRoute = () => location.hash.slice(1) || "overview";
function route() {
  if (opening) return Promise.resolve();
  return withLoading(renderRoute);
}
async function renderRoute() {
  if (opening) return;
  const current = ++routeVersion;
  $("#modal").close();
  // Encerra recursos da tela anterior (consulta ao vivo, heartbeat, animações do mapa).
  dispose?.();
  dispose = null;
  const flow = new URLSearchParams(location.search).get("flow");
  if (flow === "reset") {
    renderAuth("reset");
    return;
  }
  if (!state.user) {
    if (!state.returnRoute) state.returnRoute = safeReturnRoute(requestedRoute());
    renderAuth(requestedRoute() === "register" ? "register" : "login");
    return;
  }
  // Activity is a CSRF-protected write; profile GET remains read-only.
  api("/auth/activity", "POST", undefined, { background: true }).catch(() => {});
  const view = requestedRoute();
  // Convite: conta pendente guarda o código no servidor e vê o aviso de verificação; conta verificada vê a prévia.
  const [root, inviteCode] = view.split("/");
  if (root === "invite") {
    if (!isInviteCode(inviteCode)) { renderHome(); return; }
    const module = await import("./invite.js");
    if (current !== routeVersion) return;
    if (!state.user.verified) { await module.keepPendingInvite(inviteCode); state.pendingInvite = true; renderHome(); return; }
    await module.renderInvite(inviteCode);
    return;
  }
  if (
    !canAccess(state.user, view) ||
    ["overview", "login", "register"].includes(view)
  ) {
    renderHome();
    return;
  }
  if (view === "notebook") { await (await import("./campaign-workspace.js")).renderNotebook(); return; }
  if (view === "campaigns") {
    await renderCampaigns();
    return;
  }
  // Funcionalidades da plataforma: #modulo/segmento/... (segmentos validados, módulo carregado sob demanda).
  const segments = view.split("/");
  const platformFeature = PLATFORM_ROUTES[segments[0]];
  if (platformFeature) {
    const rest = segments.slice(1);
    if (!rest.every(isSafeSegment) || !canOpenPlatform(state.user, segments[0])) {
      renderHome();
      return;
    }
    const module = await import(platformFeature[0]);
    if (current !== routeVersion) return;
    const cleanup = await module[platformFeature[1]](rest);
    if (current !== routeVersion) cleanup?.();
    else if (typeof cleanup === "function") dispose = cleanup;
    return;
  }
  if (segments[0] === "character" && segments.length <= 3 && (segments[1] === "new" || isGuid(segments[1])) && (!segments[2] || isGuid(segments[2]))) {
    const module = await import("./character-sheet.js");
    if (current !== routeVersion) return;
    const cleanup = await module.renderCharacterPage(segments[1], segments[2]);
    if (current !== routeVersion) cleanup?.(); else dispose = cleanup;
    return;
  }
  const target = parseRoute(view);
  const feature = {
    campaign: ["./campaign-page.js", "renderCampaignPage"],
    table: ["./table.js", "renderTable"],
    session: ["./session-history.js", "renderHistory"],
  }[target.view];
  if (feature) {
    if (!isGuid(target.id)) {
      location.hash = "campaigns";
      return;
    }
    const module = await import(feature[0]);
    if (current !== routeVersion) return;
    const cleanup = await module[feature[1]](
      target.id,
      target.tab || undefined,
    );
    if (current !== routeVersion) cleanup?.();
    else if (typeof cleanup === "function") dispose = cleanup;
    return;
  }
  if (view === "settings") {
    const { renderProfile } = await import("./profile.js");
    if (current !== routeVersion) return;
    await renderProfile();
    return;
  }
  // "Mesa rápida" virou a página One-shot; links antigos para #dice seguem para ela.
  if (view === "dice") {
    location.hash = "one-shot";
    return;
  }
  const allowed = ["characters", "history"];
  if (allowed.includes(view)) {
    shell(view);
    state.characters = await api("/characters");
    if (current !== routeVersion) return;
    const game = await import("./game.js");
    if (current !== routeVersion) return;
    await game.renderGame();
    return;
  }
  renderHome();
}
function failure(error) {
  toast(error.message);
  const main = $("#main");
  if (main)
    main.innerHTML =
      '<section class="empty"><h2>O portão está temporariamente fechado.</h2><p>Recarregue a página para tentar novamente.</p></section>';
}
window.addEventListener("hashchange", () => route().catch(failure));
window.addEventListener("session-expired", () => {
  if (!state.user) return;
  state.returnRoute = safeReturnRoute(requestedRoute());
  state.sessionExpired = true;
  ++routeVersion;
  dispose?.();
  dispose = null;
  $("#modal").close();
  state.user = null;
  state.campaign = null;
  state.liveTable = null;
  state.campaigns = []; state.characters = [];
  clearCsrf();
  if (!opening) renderAuth();
});

async function boot() {
  try {
    await renewCsrf();
    state.providers = await api("/auth/providers");
    await refreshUser();
    if (state.user) {
      const destination = takeReturnRoute();
      if (destination) history.replaceState(null, "", "/#" + destination);
    }
  } catch (error) {
    bootError = error;
  }
  const params = new URLSearchParams(location.search);
  if (params.get("flow") === "confirm") {
    try {
      const r = await api("/auth/confirm", "POST", {
        userId: params.get("userId"),
        code: params.get("code"),
      });
      await refreshUser();
      await renewCsrf();
      state.notice = r.message;
    } catch (error) {
      state.notice = error.message;
    }
    history.replaceState(null, "", "/#overview");
  }
}
const bootPromise = boot().finally(() => {
  bootReady = true;
});
setTimeout(
  async () => {
    opening = false;
    endOpening();
    // The splash ends on its own clock, even when the backend is slow or unavailable.
    const readyAtOpeningEnd = bootReady;
    await route().catch(failure);
    bootPromise.then(async () => {
      if (!readyAtOpeningEnd && state.user) await route().catch(failure);
      const error = new URLSearchParams(location.search).get("authError");
      if (error) {
        toast(
          error === "provider"
            ? "Este provedor ainda não foi configurado."
            : "Não foi possível usar o acesso social. É necessário e-mail verificado e sem vínculo com outra conta local.",
        );
        history.replaceState(null, "", "/#login");
      }
      if (state.notice) toast(state.notice);
      if (bootError)
        toast(
          "Não foi possível conectar ao servidor. Verifique a conexão e recarregue.",
        );
    });
  },
  openingDeadline(started, performance.now()),
);
