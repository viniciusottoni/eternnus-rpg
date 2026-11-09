import { state } from "./state.js";
import { installButton } from "./pwa.js";
import { $, esc, button } from "./ui.js";
import { isAdmin, isStaff, isInviteCode } from "./policy.js";
import { api } from "./api.js";
// [rota, ícone, rótulo, principal no celular?, visível para?]. Itens secundários aparecem no menu "Mais" da barra inferior.
// Admin resolve chamados e edita fichas-modelo dentro do Painel admin; por isso Suporte e Fichas-modelo saem do menu dele.
const notAdmin = (user) => !isAdmin(user);
const ambassadorOnly = (user) => isStaff(user) && !isAdmin(user);
const navigation = [
  ["overview", "⌂", "Início", true],
  ["campaigns", "⚑", "Campanhas", true],
  ["guild", "⚜", "Guilda", true],
  ["characters", "♜", "Personagens", true],
  ["one-shot", "⬡", "One-shot", false],
  ["library", "❖", "Biblioteca", false],
  ["progress", "✶", "Conquistas", false],
  ["support", "✉", "Suporte", false, notAdmin],
  ["templates", "▤", "Fichas-modelo", false, ambassadorOnly],
  ["admin", "♛", "Painel admin", false, isAdmin],
  ["settings", "⚙", "Minha conta", false],
];
const visible = () => navigation.filter((n) => !n[4] || n[4](state.user));
const routeOf = (view) => String(view || "").split("/")[0];
function navLink([route, icon, label, primary], view) {
  const locked = !state.user.verified && !["overview", "settings"].includes(route);
  const cls = `nav-item ${primary ? "nav-primary" : "nav-secondary"}`;
  return locked
    ? `<span class="${cls} locked" aria-disabled="true" tabindex="0" aria-describedby="account-verify-help" data-tip="Confirme seu e-mail"><i>${icon}</i>${label}<small>♙</small></span>`
    : `<a class="${cls} ${routeOf(view) === route ? "active" : ""}" href="#${route}"${routeOf(view) === route ? ' aria-current="page"' : ""}><i>${icon}</i>${label}</a>`;
}
export function navLinks(view) {
  const items = visible();
  const secondaryActive = items.some((n) => !n[3] && routeOf(view) === n[0]);
  // "Mais" só aparece na barra inferior do celular (CSS) e abre o painel com os itens secundários.
  return (
    items.map((n) => navLink(n, view)).join("") +
    `<button type="button" class="nav-item nav-more ${secondaryActive ? "active" : ""}" data-action="nav-more" aria-expanded="false" aria-controls="nav-more-panel"><i>☰</i>Mais</button>`
  );
}
function moreItems(view) {
  return visible()
    .filter((n) => !n[3])
    .map((n) => navLink(n, view))
    .join("");
}
const mobileNavigation = window.matchMedia("(max-width: 760px)");
function placeAccountControls() {
  const sidebar = document.querySelector(".app-shell .sidebar");
  const panel = document.getElementById("nav-more-panel");
  if (!sidebar || !panel) return;
  const profile = sidebar.querySelector(".profile-block");
  const logout = sidebar.querySelector('[data-action="auth-signout"]');
  if (mobileNavigation.matches) {
    panel.prepend(profile);
    panel.append(logout);
  } else {
    sidebar.querySelector(".brand").after(profile);
    sidebar.append(logout);
  }
}
export function shell(view) {
  $("#app").className = "app-shell";
  $("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="#overview"><img src="/assets/eternnus-logo.webp" alt="Eternnus RPG"><span>FORJE A SUA LENDA</span></a><div class="profile-block"><img class="avatar" src="${esc(state.user.avatarUrl)}" alt="Avatar de ${esc(state.user.name)}" referrerpolicy="no-referrer"><div><strong>${esc(state.user.name)}</strong><small class="${state.user.verified ? "verified" : "pending"}">● ${state.user.verified ? "Conta verificada" : "Confirmação pendente"}</small>${state.user.verified ? `<a class="level-chip" href="#progress" data-tip="Seu nível e conquistas">Nível ${Number(state.user.level) || 1}${isStaff(state.user) ? ` · ${state.user.role === "admin" ? "Admin" : "Embaixador"}` : ""}</a>` : ""}</div></div><span class="nav-caption">SEU UNIVERSO</span>${state.user.verified ? "" : '<p id="account-verify-help" class="form-help">Confirme seu e-mail para acessar os destinos de jogo.</p>'}<nav aria-label="Menu principal">${navLinks(view)}</nav><div id="nav-more-panel" class="nav-more-panel metal" hidden><span class="nav-caption">MAIS CAMINHOS</span>${moreItems(view)}</div><div class="sidebar-quote"><span>✧</span><p>Grandes histórias começam<br>com uma escolha.</p></div>${button("↪ Sair da conta", "auth-signout", "", "logout")}</aside><div class="workspace"><header class="topbar"><div class="breadcrumb">ETERNNUS <span>/</span> ${esc(navigation.find((n) => n[0] === routeOf(view))?.[2] || "Seu universo")}</div>${installButton()}<div class="topbar-end"><span class="world-status"><i></i> O próximo capítulo é seu</span><div class="music-dock"></div></div></header><main id="main" tabindex="-1"></main><footer><span>ETERNNUS RPG</span><span>Escreva histórias. Viva lendas.</span><span>✧</span></footer></div>`;
  placeAccountControls();
}
export function renderHome() {
  shell("overview");
  const verified = state.user.verified;
  $("#main").innerHTML =
    `<div class="page-heading"><div><span class="eyebrow">SEU REFÚGIO ENTRE AVENTURAS</span><h1>Bem-vindo, ${esc(state.user.name)}.</h1><p>${verified ? "O mundo está à sua espera. Escolha onde sua próxima história começa." : "Sua conta foi criada. Falta apenas confirmar o seu e-mail para começar."}</p></div><span class="chapter">CAPÍTULO I <span>✦</span></span></div>${verified ? '<section id="home-next" class="home-next" aria-live="polite"></section>' : ""}<section class="welcome-scene"><div><span class="eyebrow">SUAS ESCOLHAS. SEU DESTINO.</span><h2>Cada jornada começa<br>com uma <em>nova lenda.</em></h2><p>Reúna sua guilda, prepare os dados e dê vida a histórias que atravessam eras.</p>${verified ? '<a href="#campaigns" class="button primary">Explorar minhas campanhas <span>→</span></a>' : '<span class="scene-caption">Seu lugar à mesa está reservado.</span>'}</div><div class="scene-rune" aria-hidden="true">✧</div></section>${verified ? `<div class="section-title"><h2>Onde a aventura começa</h2><span>SEU UNIVERSO, EM UM SÓ LUGAR</span></div>` : `<section class="verification-banner metal"><div class="mail-sigil" aria-hidden="true">✉</div><div><h2>Confirme seu e-mail para abrir os portões.</h2><p>Enviamos um link para <strong>${esc(state.user.email)}</strong>. Confira também a pasta de spam.</p><div class="buttons">${button("↗ Reenviar e-mail", "auth-resend", "", "primary")}${button("✓ Já confirmei", "auth-refresh", "", "subtle")}</div><p class="delivery-hint">${esc(state.mailHint || "")}</p>${state.pendingInvite ? '<p class="notice-box">Seu convite está guardado. Depois de confirmar o e-mail, volte aqui e continue para a campanha.</p>' : ""}</div><span class="banner-seal" aria-hidden="true">✦</span></section>`}<div class="feature-cards">${[
      ["campaigns", "⚑", "Campanhas", "Crie mundos e reúna sua guilda."],
      ["characters", "♜", "Personagens", "Dê vida à sua próxima lenda."],
      ["one-shot", "⬡", "One-shot", "Uma mesa rápida, aberta na hora."],
      ["settings", "⚙", "Minha conta", "Seu nome e seu lugar neste mundo."],
    ]
      .map(([route, icon, title, desc]) =>
        (verified || route === "settings")
          ? `<a href="#${route}" class="feature-card metal"><span class="feature-icon">${icon}</span><h3>${title}</h3><p>${desc}</p><span class="card-arrow">↗</span></a>`
          : `<div class="feature-card metal locked" aria-disabled="true"><span class="feature-icon">${icon}</span><span class="lock-mark" aria-label="Bloqueado">♙</span><h3>${title}</h3><p>${desc}</p></div>`,
      )
      .join(
        "",
      )}</div><div class="home-footnote"><span>✦</span> Toda grande história merece ser vivida.</div>`;
  if (verified) loadNext();
  else if (!state.pendingInvite)
    api("/invites/pending", "GET", undefined, { background: true }).then((r) => {
      if (!r?.code || state.pendingInvite) return;
      state.pendingInvite = true;
      document.querySelector(".verification-banner .delivery-hint")?.insertAdjacentHTML("afterend", '<p class="notice-box">Seu convite está guardado. Depois de confirmar o e-mail, volte aqui e continue para a campanha.</p>');
    }).catch(() => {});
}

/** Próxima partida em destaque: mesa ativa (“Retomar mesa”), pendências reais e campanha recente. */
async function loadNext() {
  const host = document.getElementById("home-next");
  if (!host) return;
  let home;
  try { home = await api("/home", "GET", undefined, { background: true }); } catch { return; }
  if (!host.isConnected) return;
  const when = (iso) => new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const active = home.active.map((c) => `<article class="resume-card metal"><span class="online-badge" data-tip="Há uma sessão ativa nesta campanha."><i aria-hidden="true"></i>${c.session?.paused ? "Pausada" : "Mesa aberta"}</span><h3>${esc(c.name)}</h3><p class="small">${esc(c.system)}${c.isMaster ? " · você é o mestre" : ""}</p><a class="button primary" href="#table/${esc(c.id)}">▶ ${c.joined ? "Retomar mesa" : "Entrar na mesa"}</a></article>`).join("");
  const pending = [
    home.pendingInvite && isInviteCode(home.pendingInvite) ? `<li><a href="#invite/${esc(home.pendingInvite)}">Você tem um convite guardado — continuar</a></li>` : "",
    home.pendingTests ? `<li>${home.pendingTests} pedido(s) de teste aguardando você na mesa</li>` : "",
    ...home.upcoming.filter((u) => !u.isMaster && !u.attendance).map((u) => `<li><a href="#campaign/${esc(u.id)}/journal">Confirme presença em ${esc(u.name)} (${esc(when(u.at))})</a></li>`),
    !home.hasCharacters && (home.active.length || home.recent.length) ? '<li><a href="#characters">Crie seu primeiro personagem</a></li>' : "",
  ].filter(Boolean).join("");
  const upcoming = home.upcoming.map((u) => `<li><strong>${esc(u.name)}</strong> — ${esc(when(u.at))}${u.attendance ? ` · ${esc({ yes: "você vai", maybe: "talvez", no: "você não vai" }[u.attendance] || "")}` : ""}</li>`).join("");
  const recent = !home.active.length && home.recent[0] ? `<article class="resume-card metal"><span class="eyebrow">CAMPANHA RECENTE</span><h3>${esc(home.recent[0].name)}</h3><p class="small">${esc(home.recent[0].system)}</p><a class="button primary" href="#campaign/${esc(home.recent[0].id)}">Continuar →</a></article>` : "";
  const empty = !active && !recent ? `<article class="resume-card metal"><h3>Sua próxima história começa aqui</h3><p class="small">Crie uma campanha, abra uma one-shot ou entre pelo link de convite que o mestre enviar.</p><div class="buttons"><a class="button primary" href="#campaigns">Criar campanha</a><a class="button subtle" href="#one-shot">One-shot rápida</a></div></article>` : "";
  host.innerHTML = `<div class="section-title"><h2>Próxima partida</h2></div><div class="resume-grid">${active}${recent}${empty}</div>${pending ? `<div class="home-pending metal"><h3>Precisa de você</h3><ul>${pending}</ul></div>` : ""}${upcoming ? `<div class="home-upcoming"><h3>Agenda</h3><ul>${upcoming}</ul></div>` : ""}`;
}

// Painel "Mais" da navegação inferior no celular. Instalado uma vez; fecha ao navegar, com Esc ou clique fora.
let moreInstalled = false;
export function installNavMore() {
  if (moreInstalled) return;
  moreInstalled = true;
  const close = () => {
    const panel = document.getElementById("nav-more-panel");
    if (panel) panel.hidden = true;
    document.querySelector('[data-action="nav-more"]')?.setAttribute("aria-expanded", "false");
  };
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest?.('[data-action="nav-more"]');
    const panel = document.getElementById("nav-more-panel");
    if (toggle && panel) {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) panel.querySelector("a")?.focus();
      return;
    }
    if (panel && !panel.hidden && !event.target.closest?.("#nav-more-panel")) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const panel = document.getElementById("nav-more-panel");
      if (panel && !panel.hidden) {
        close();
        document.querySelector('[data-action="nav-more"]')?.focus();
      }
    }
  });
  mobileNavigation.addEventListener("change", () => {
    close();
    placeAccountControls();
  });
  window.addEventListener("hashchange", close);
}
