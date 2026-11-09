import { helpButton } from "./help.js";
// Nível, XP e conquistas (#progress) e ranking (#progress/ranking[/week]).
// Apresentação apenas: valores e conquistas vêm de /api/progress; cálculos/formatação em progress-policy.js.
import { api } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import { $, esc, button, empty } from "./ui.js";
import {
  levelProgress,
  formatXp,
  formatSigned,
  amountLabel,
  dailyLimitLabel,
  todayLabel,
  progressText,
  rankingPeriod,
  sortAchievements,
  nextUnlocks,
  nextMilestones,
  formatDay,
} from "./progress-policy.js";

let generation = 0;

export async function renderProgress(segments = []) {
  shell("progress");
  const request = ++generation;
  const tab = segments[0] === "ranking" ? "ranking" : "overview";
  const period = rankingPeriod(segments[1]);
  $("#main").innerHTML =
    `<div class="page-heading"><div><span class="eyebrow">SUA LENDA EM CONSTRUÇÃO</span><h1>Nível e conquistas ${helpButton("progresso.jornada.niveis", "Níveis e conquistas")}<span class="heading-gem" aria-hidden="true">✶</span></h1><p>Sessões, criação e colaboração constroem sua jornada. Evolua no seu ritmo.</p></div></div>
  <nav class="page-tabs" aria-label="Seções de progresso">${[
    ["overview", "#progress", "Minha jornada"],
    ["ranking", "#progress/ranking", "Ranking"],
  ]
    .map(([key, href, label]) => `<a href="${href}"${key === tab ? ' aria-current="page" class="active"' : ""}>${label}</a>`)
    .join("")}</nav>
  <section id="progress-content" class="progress-page" aria-live="polite"><p class="loading-line" role="status">Consultando os anais da Guilda…</p></section>`;
  const target = $("#progress-content");
  target.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "progress-retry") renderProgress(segments);
  });
  try {
    if (tab === "ranking") {
      const data = await api("/progress/leaderboard?period=" + period);
      if (request !== generation) return;
      target.innerHTML = rankingView(data, period);
    } else {
      const data = await api("/progress/me");
      if (request !== generation) return;
      target.innerHTML = overviewView(data);
      syncUser(data);
    }
    applyBars(target);
    guardImages(target);
  } catch (error) {
    if (request !== generation) return;
    target.innerHTML = `<div class="empty progress-error" role="alert"><span class="empty-sigil" aria-hidden="true">⚠</span><h3>Não foi possível abrir seus registros.</h3><p>${esc(error.message)}</p>${button("Tentar novamente", "progress-retry", "", "primary")}</div>`;
  }
}

// ---------- Minha jornada ----------

function overviewView(d) {
  const progress = levelProgress(d.xp);
  const unlocked = d.achievements.filter((a) => a.unlocked).length;
  return `${heroView(d, progress, unlocked)}
  <aside class="journey-principles metal"><strong>Uma jornada, muitos caminhos.</strong><p>Seu XP não expira por ausência. Não há sequência diária para manter, nem perda por deixar de jogar. Os tetos abaixo limitam somente as recompensas; você continua participando normalmente.</p></aside>
  ${milestonesView(d.achievements)}
  <div class="progress-columns">
    <section class="progress-panel metal" aria-labelledby="xp-rules-title">
      <div class="section-title"><h2 id="xp-rules-title">Como ganhar XP</h2>${helpButton("progresso.jornada.pontos", "Pontos e limites diários")}<span>TETOS DE RECOMPENSA · DIA UTC</span></div>
      ${rulesTable(d.rules)}
    </section>
    <section class="progress-panel metal" aria-labelledby="unlocks-title">
      <div class="section-title"><h2 id="unlocks-title">Próximos desbloqueios</h2></div>
      ${unlocksView(d.unlocks, d.level)}
    </section>
  </div>
  <section aria-labelledby="achievements-title">
    <div class="section-title"><h2 id="achievements-title">Conquistas</h2><span>${unlocked} DE ${d.achievements.length}</span></div>
    <p class="muted small">Marcos permanentes, sem prazo. Os contadores consideram atividades que receberam XP; lançamentos antigos continuam valendo.</p>
    <ul class="achievement-grid">${sortAchievements(d.achievements).map(achievementView).join("")}</ul>
  </section>
  <section class="progress-panel metal" aria-labelledby="history-title">
    <div class="section-title"><h2 id="history-title">Histórico recente</h2><span>ÚLTIMOS ${d.history.length || 0} LANÇAMENTOS</span></div>
    ${historyView(d.history)}
  </section>`;
}

function heroView(d, progress, unlocked) {
  const span = progress.nextLevelXp == null ? 1 : progress.nextLevelXp - progress.levelXp;
  const now = progress.nextLevelXp == null ? 1 : progress.xp - progress.levelXp;
  const text = progressText(progress);
  return `<section class="progress-hero metal" aria-labelledby="progress-level">
    <div class="level-crest" aria-hidden="true"><div class="level-crest-inner"><small>NÍVEL</small><strong>${progress.level}</strong><i>✦</i></div></div>
    <div class="progress-hero-copy">
      <span class="eyebrow">${esc(state.user?.name || "Aventureiro")}</span>
      <h2 id="progress-level">Nível ${progress.level}${progress.level >= d.maxLevel ? " · máximo" : ""}</h2>
      <p class="progress-total">${esc(formatXp(progress.xp))} acumulados${progress.nextLevelXp == null ? "" : ` · faltam <b>${esc(formatXp(progress.remaining))}</b> para o nível ${progress.level + 1}`}</p>
      <div class="xp-bar" role="progressbar" aria-label="Progresso até o próximo nível" aria-valuemin="0" aria-valuemax="${span}" aria-valuenow="${now}" aria-valuetext="${esc(text)}"><span class="xp-bar-fill" data-percent="${progress.percent}"></span></div>
      <p class="xp-bar-text">${esc(text)}</p>
    </div>
    <dl class="stat-grid progress-stats">
      <div class="stat-tile"><dt><span>Conquistas</span></dt><dd><strong>${unlocked}/${d.achievements.length}</strong></dd></div>
      <div class="stat-tile"><dt><span>XP total</span></dt><dd><strong>${esc(new Intl.NumberFormat("pt-BR").format(progress.xp))}</strong></dd></div>
      <div class="stat-tile"><dt><span>Próximo nível</span></dt><dd><strong>${progress.nextLevelXp == null ? "—" : progress.level + 1}</strong></dd></div>
    </dl>
  </section>`;
}

function rulesTable(rules) {
  return `<div class="data-table-wrap"><table class="data-table xp-rules"><caption class="sr-only">XP concedido por atividade, limite diário e uso de hoje</caption>
    <thead><tr><th scope="col">Atividade</th><th scope="col" class="num">XP</th><th scope="col">Limite</th></tr></thead>
    <tbody>${rules
      .map((r) => {
        const today = todayLabel(r.today, r.dailyLimit);
        const full = r.dailyLimit != null && r.today >= r.dailyLimit;
        return `<tr><th scope="row"><span class="rule-label">${esc(r.label)}</span><small>${esc(r.hint)}</small></th><td class="num"><b>${esc(amountLabel(r.amount))}</b></td><td>${esc(dailyLimitLabel(r.dailyLimit))}${today ? `<small class="${full ? "rule-full" : ""}">${full ? "⌛ " : ""}${esc(today)}</small>` : ""}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
}

function unlocksView(unlocks, level) {
  const next = nextUnlocks(unlocks);
  const done = unlocks.filter((u) => u.unlocked);
  const item = (u) =>
    `<li class="unlock${u.unlocked ? " is-unlocked" : ""}"><span class="unlock-level">Nv. ${esc(u.level)}</span><div><strong>${esc(u.title)}</strong><small>${esc(u.description)}</small></div><span class="status-chip ${u.unlocked ? "good" : "quiet"}">${u.unlocked ? "Liberado" : `Faltam ${esc(u.level - level)} ${u.level - level === 1 ? "nível" : "níveis"}`}</span></li>`;
  return `${next.length ? `<ul class="unlock-list">${next.map(item).join("")}</ul>` : `<p class="muted small">Todos os recursos por nível já estão liberados para você.</p>`}
    ${done.length ? `<details class="unlocked-details"><summary>Já liberados (${done.length})</summary><ul class="unlock-list">${done.map(item).join("")}</ul></details>` : ""}
    <p class="muted small unlock-note">Jogar, entrar em campanhas e responder na Guilda nunca exigem nível.</p>`;
}

function achievementView(a) {
  const status = a.unlocked
    ? `<span class="achievement-date">✓ ${a.unlockedAt ? `Conquistada em ${esc(formatDay(a.unlockedAt))}` : "Conquistada · trajetória reconhecida"}</span>`
    : `<span class="achievement-date">Em andamento · ${esc(a.current || 0)} de ${esc(a.threshold)}</span>`;
  return `<li class="achievement${a.unlocked ? " is-unlocked" : " is-locked"}"><span class="achievement-icon" aria-hidden="true">${esc(a.icon)}</span><div><strong>${esc(a.title)}</strong><p>${esc(a.description)}</p>${status}${achievementMeter(a)}</div></li>`;
}

function achievementMeter(a) {
  const max = Math.max(1, Number(a.threshold) || 1);
  const value = Math.min(max, Math.max(0, Number(a.current) || 0));
  return `<progress class="achievement-meter" max="${max}" value="${value}" aria-label="${esc(a.title)}: ${value} de ${max}">${value} de ${max}</progress>`;
}

function milestonesView(achievements) {
  const next = nextMilestones(achievements);
  if (!next.length) return "";
  return `<section aria-labelledby="milestones-title"><div class="section-title"><h2 id="milestones-title">Seu próximo capítulo</h2><span>ESCOLHA O QUE COMBINA COM VOCÊ</span></div><div class="milestone-grid">${next.map(a => `<article class="milestone metal"><span class="eyebrow">${esc(a.current)} / ${esc(a.threshold)} · SEM PRAZO</span><h3>${esc(a.title)}</h3><p>${esc(a.description)}</p>${achievementMeter(a)}<a class="button subtle" href="${a.href}">${esc(a.action)} <span aria-hidden="true">→</span></a></article>`).join("")}</div></section>`;
}

function historyView(history) {
  if (!history.length)
    return `<p class="muted small">Nenhum XP ainda. Crie uma ficha ou participe de uma sessão para começar sua lenda.</p>`;
  return `<ol class="xp-history">${history
    .map(
      (h) =>
        `<li><span class="xp-amount${h.amount < 0 ? " negative" : ""}">${esc(formatSigned(h.amount))} XP</span><span class="xp-label">${esc(h.label)}</span><time datetime="${esc(h.createdAt)}">${esc(formatDay(h.createdAt, true))}</time></li>`,
    )
    .join("")}</ol>`;
}

// ---------- Ranking ----------

function rankingView(data, period) {
  const periods = `<nav class="ranking-periods" aria-label="Período do ranking">${[
    ["all", "#progress/ranking", "Geral"],
    ["week", "#progress/ranking/week", "Últimos 7 dias"],
  ]
    .map(([key, href, label]) => `<a class="button small ${key === period ? "primary" : "subtle"}" href="${href}"${key === period ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("")}</nav>`;
  if (!data.items.length)
    return `${periods}${empty(period === "week" ? "Ninguém pontuou nos últimos 7 dias." : "O ranking ainda está vazio.", "Jogue uma sessão, crie uma ficha ou participe da Guilda para abrir o placar.")}`;
  return `${periods}<div class="data-table-wrap ranking metal"><table class="data-table"><caption class="sr-only">${period === "week" ? "Ranking dos últimos 7 dias" : "Ranking geral"}: 20 primeiros aventureiros</caption>
    <thead><tr><th scope="col" class="num">#</th><th scope="col">Aventureiro</th><th scope="col" class="num">Nível</th><th scope="col" class="num">${period === "week" ? "XP na semana" : "XP total"}</th></tr></thead>
    <tbody>${data.items
      .map(
        (r) =>
          `<tr${r.isMe ? ' class="is-me"' : ""}><td class="num"><span class="rank rank-${r.rank <= 3 ? r.rank : "n"}">${r.rank}</span></td><td><span class="ranking-user"><img class="avatar" src="${esc(r.avatarUrl)}" alt="" referrerpolicy="no-referrer" loading="lazy"><span>${esc(r.name)}${r.isMe ? ' <span class="badge">Você</span>' : ""}</span></span></td><td class="num">${esc(r.level)}</td><td class="num">${esc(formatXp(r.xp))}</td></tr>`,
      )
      .join("")}</tbody></table></div>
    <p class="muted small">Contas não verificadas não aparecem. ${period === "week" ? "Soma do XP recebido nos últimos 7 dias." : "XP acumulado desde o início."}</p>`;
}

// ---------- Auxiliares ----------

/** Largura da barra via CSSOM (sem estilo inline no HTML, compatível com a CSP). */
function applyBars(root) {
  root.querySelectorAll(".xp-bar-fill[data-percent]").forEach((bar) => {
    const percent = Math.min(100, Math.max(0, Number(bar.dataset.percent) || 0));
    bar.style.width = percent + "%";
  });
}

/** Avatar de outra conta pode não ser visível: cai no avatar padrão. */
function guardImages(root) {
  root.querySelectorAll("img.avatar").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        if (!img.src.endsWith("/assets/avatar.svg")) img.src = "/assets/avatar.svg";
      },
      { once: true },
    );
  });
}

/** Mantém o selo de nível do menu coerente com o servidor. */
function syncUser(d) {
  if (!state.user) return;
  state.user.level = d.level;
  state.user.xp = d.xp;
  const chip = document.querySelector(".level-chip");
  if (chip?.firstChild?.nodeType === Node.TEXT_NODE)
    chip.firstChild.textContent = chip.firstChild.textContent.replace(/Nível \d+/, `Nível ${Number(d.level) || 1}`);
}
