// Página da campanha (Tela 05) e abertura de sessão (Tela 06).
import { api } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import {
  $,
  esc,
  button,
  modal,
  formError,
  submitForm,
  toast,
  empty,
  formatDate,
  navigate,
} from "./ui.js";
import { campaignForm, confirmCampaign } from "./campaigns.js";
import { formatDuration, isGuid, sessionLabel } from "./session-policy.js";
import { mapThumbnail } from "./table-map.js";
import { guardAvatars } from "./sheet.js";
import { renderCampaignLibrary, renderCampaignMaps } from "./campaign-assets.js";
import { keepMasterPresence } from "./session-presence.js";

const TABS = [
  ["overview", "Visão geral", false],
  ["sessions", "Sessões", true],
  ["players", "Jogadores", false],
  ["resources", "Bibliotecas", false],
  ["maps", "Mapas", true],
  ["settings", "Configurações", true],
];
let page = 1,
  generation = 0,
  currentCampaign = "";

export async function renderCampaignPage(id, tab = "overview") {
  shell("campaigns");
  const request = ++generation;
  if (currentCampaign !== id) page = 1;
  currentCampaign = id;
  $("#main").innerHTML =
    '<p class="loading-line" role="status">Abrindo o grimório da campanha…</p>';
  const detail = await api("/campaigns/" + id);
  if (request !== generation) return;
  state.campaign = detail;
  const visible = TABS.filter(
    ([, , masterOnly]) => !masterOnly || detail.isMaster,
  );
  if (!visible.some(([key]) => key === tab))
    tab = detail.isMaster ? "sessions" : "overview";
  const online = !!detail.activeSession;
  const masterName = detail.masterName || "o mestre";
  $("#main").innerHTML =
    `<a class="back-link" href="#campaigns">← Minhas campanhas</a>
  <section class="campaign-hero metal"><div class="campaign-hero-copy"><span class="eyebrow">${esc(detail.system)}</span><h1>${esc(detail.name)}</h1><p>${esc(detail.description || "Uma nova história aguarda seu primeiro capítulo.")}</p><div class="hero-meta"><span>♛ <b>Mestre:</b> ${esc(masterName)}</span><span>♙ <b>${detail.members.length}</b> ${detail.members.length === 1 ? "jogador" : "jogadores"}</span>${detail.isMaster ? `<span>▣ <b>${detail.sessionCount}</b> ${detail.sessionCount === 1 ? "sessão" : "sessões"}</span>` : ""}${online ? '<span class="online-badge"><i aria-hidden="true"></i>ONLINE</span>' : ""}</div></div>${online ? `<a class="button primary enter-table" href="#table/${esc(id)}">▶ ${detail.isMaster ? "Voltar à mesa" : "Entrar na mesa"}</a>` : ""}</section>
  <nav class="page-tabs" aria-label="Seções da campanha">${visible.map(([key, label]) => `<a href="#campaign/${esc(id)}/${key}" ${key === tab ? 'aria-current="page" class="active"' : ""}>${label}</a>`).join("")}</nav>
  <div class="campaign-page-grid"><section id="campaign-tab" class="campaign-tab" aria-live="polite"></section>${overviewCard(detail)}</div>`;
  await renderTab(detail, tab);
  guardAvatars($("#main"));
  if (detail.isOneShot) $(".campaign-hero-copy").insertAdjacentHTML("beforeend", `<p class="notice-box">One-shot: os dados serão removidos quando o mestre sair ou ficar 45 segundos desconectado. Prazo máximo: ${esc(new Date(detail.expiresAt).toLocaleString("pt-BR"))}.</p>`);
  const releasePresence = keepMasterPresence(detail);
  return () => { ++generation; releasePresence(); };
}

function overviewCard(d) {
  const online = !!d.activeSession;
  return `<aside class="campaign-aside metal" aria-label="Visão da campanha"><h2>Visão da campanha</h2><dl><div><dt>Estado atual</dt><dd>${online ? '<span class="online-badge"><i aria-hidden="true"></i>Online</span>' : '<span class="offline-badge">Offline</span>'}</dd></div>${d.isMaster ? `<div><dt>Sessões realizadas</dt><dd>${String(d.sessionCount).padStart(2, "0")} ${d.sessionCount === 1 ? "sessão" : "sessões"}</dd></div>` : ""}<div><dt>Participantes</dt><dd>${d.members.length} ${d.members.length === 1 ? "aventureiro" : "aventureiros"}</dd></div>${online ? `<div><dt>Sessão em andamento</dt><dd>${esc(sessionLabel(d.activeSession.number, d.activeSession.title))}</dd></div>` : ""}<div><dt>Seu acesso</dt><dd>${d.isMaster ? "Mestre · histórico e notas" : "Jogador · mesa e ficha"}</dd></div></dl>${online ? `<a class="button primary" href="#table/${esc(d.id)}">▶ ${d.isMaster ? "Voltar à mesa" : "Entrar na mesa"}</a>` : d.isMaster ? button("✦ Iniciar nova sessão", "cp-start", d.id, "primary") : '<p class="muted small waiting-note">⌛ Aguardando o mestre abrir a próxima sessão.</p>'}${d.isMaster ? `<a class="button subtle" href="#campaign/${esc(d.id)}/players">⚑ Gerenciar jogadores</a>` : ""}</aside>`;
}

async function renderTab(d, tab) {
  const target = $("#campaign-tab");
  if (tab === "sessions") return renderSessions(d, target);
  if (tab === "players") {
    target.innerHTML = `<div class="section-title"><h2>Jogadores</h2>${d.isMaster ? "" : button("+ Vincular minha ficha", "cp-link", d.id, "subtle small")}</div>${
      d.members.length
        ? `<ul class="member-list">${d.members
            .map((m) => {
              const sheets = d.characters.filter((c) => c.ownerId === m.id);
              return `<li class="member-row metal"><img class="avatar" src="${esc(m.avatarUrl)}" alt="" referrerpolicy="no-referrer"><div><strong>${esc(m.name)}</strong><small>${sheets.length ? sheets.map((c) => `${esc(c.name)} · Nv. ${c.level} · Vida ${c.hp}/${c.maxHp}`).join("<br>") : "Nenhuma ficha vinculada"}</small></div>${d.isMaster ? button("Remover", "cp-remove", m.id, "subtle small") : ""}</li>`;
            })
            .join("")}</ul>`
        : empty(
            "Sua guilda ainda está se formando.",
            d.isMaster
              ? "Compartilhe o código de convite para reunir os jogadores."
              : "Os demais jogadores aparecerão aqui.",
          )
    }${d.isMaster ? inviteBox(d) : ""}`;
    return;
  }
  if (tab === "resources") return renderCampaignLibrary(d, target);
  if (tab === "maps") return renderCampaignMaps(d, target);
  if (tab === "settings") {
    target.innerHTML = `<div class="section-title"><h2>Configurações</h2></div><div class="settings-list"><article class="metal"><h3>Identidade da campanha</h3><p class="muted small">Nome, sistema e premissa.</p>${button("Editar campanha", "cp-edit", d.id, "subtle")}</article>${inviteBox(d)}<article class="metal danger-zone"><h3>Excluir campanha</h3><p class="muted small">${d.members.length ? "Indisponível enquanto houver jogadores vinculados." : "Sessões, registros e recursos serão apagados. Fichas pessoais são preservadas."}</p>${button("Excluir campanha", "cp-delete", d.id, "danger", d.members.length ? "disabled" : "")}</article></div>`;
    await templateSettings(d, target);
    return;
  }
  target.innerHTML = `<a class="button primary" href="#character/new/${esc(d.id)}">+ Criar ficha para esta campanha</a><div class="section-title"><h2>Visão geral</h2></div><article class="overview-story metal"><h3>Premissa</h3><p>${esc(d.description || "A premissa desta campanha ainda será escrita.")}</p></article>${
    d.activeSession
      ? `<article class="live-callout metal"><span class="online-badge"><i aria-hidden="true"></i>Sessão em andamento</span><h3>${esc(sessionLabel(d.activeSession.number, d.activeSession.title))}</h3><p class="muted small">Iniciada em ${formatDate(d.activeSession.startedAt)}.</p><a class="button primary" href="#table/${esc(d.id)}">▶ ${d.isMaster ? "Voltar à mesa" : "Entrar na mesa"}</a></article>`
      : `<article class="live-callout metal offline"><h3>Campanha offline</h3><p class="muted small">${d.isMaster ? "Inicie uma sessão para colocar a campanha online e receber os jogadores." : "Quando o mestre iniciar uma sessão, a campanha aparecerá como ONLINE e você entrará direto na mesa."}</p></article>`
  }<article class="metal overview-party"><h3>Personagens do grupo</h3>${d.characters.length ? `<ul>${d.characters.map((c) => `<li><strong>${esc(c.name)}</strong><span>${esc(c.archetype || "Aventureiro")} · Nv. ${c.level} · Vida ${c.hp}/${c.maxHp}</span></li>`).join("")}</ul>` : '<p class="muted small">Nenhuma ficha vinculada ainda.</p>'}</article>`;
}

function inviteBox(d) {
  return `<article class="metal invite-box"><h3>Código de convite</h3><p class="muted small">Compartilhe apenas com quem deseja convidar.</p><div class="invite-code"><code>${esc(d.inviteCode)}</code>${button("Copiar", "cp-copy", d.inviteCode, "subtle small")}</div></article>`;
}

async function renderSessions(d, target) {
  target.innerHTML =
    '<p class="loading-line" role="status">Consultando as crônicas…</p>';
  const result = await api(`/campaigns/${d.id}/sessions?page=${page}`);
  if ($("#campaign-tab") !== target) return;
  const live = result.items.find((s) => s.active);
  target.innerHTML = `<div class="section-title"><h2>Histórico de sessões</h2>${live ? `<a class="button primary" href="#table/${esc(d.id)}">▶ Voltar à mesa</a>` : button("✦ Iniciar nova sessão", "cp-start", d.id, "primary start-session")}</div>${
    result.items.length
      ? `<ol class="session-list">${result.items
          .map((s) => {
            const minutes = s.endedAt
              ? (new Date(s.endedAt) - new Date(s.startedAt)) / 60000
              : (Date.now() - new Date(s.startedAt)) / 60000;
            return `<li class="session-row metal ${s.active ? "active" : ""}"><div class="session-thumb ${s.mapKind === "tileset" ? "tileset" : "cartographic"}" aria-hidden="true"></div><div class="session-info"><h3><a href="#session/${esc(s.id)}">${esc(sessionLabel(s.number, s.title))}</a></h3><p>${new Date(s.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })} · ${formatDuration(minutes)} · ${s.eventCount} eventos · ${s.noteCount} ${s.noteCount === 1 ? "nota" : "notas"} · ${s.participantCount} ${s.participantCount === 1 ? "aventureiro" : "aventureiros"}</p></div><div class="session-row-actions">${s.active ? '<span class="online-badge"><i aria-hidden="true"></i>Em andamento</span>' : '<span class="status-chip">◉ Encerrada</span>'}<a class="button subtle small" href="#session/${esc(s.id)}/timeline">◷ Histórico</a><a class="button subtle small" href="#session/${esc(s.id)}/notes">✎ Notas</a></div></li>`;
          })
          .join("")}</ol>${pagination(result)}`
      : empty(
          "O primeiro capítulo espera por você.",
          "Inicie uma sessão para colocar a campanha online. Cada sessão guarda sua própria linha do tempo, rolagens, alterações de fichas e anotações.",
          "cp-start",
          "✦ Iniciar primeira sessão",
        )
  }`;
  const startButton = target.querySelector('[data-action="cp-start"]');
  if (startButton) startButton.dataset.id = d.id;
}

function pagination(r) {
  if (r.total <= r.pageSize) return "";
  const pages = Math.ceil(r.total / r.pageSize);
  return `<div class="pagination">${button("← Mais recentes", "cp-page", r.page - 1, "subtle", r.page === 1 ? "disabled" : "")}<span>Página ${r.page} de ${pages}</span>${button("Anteriores →", "cp-page", r.page + 1, "subtle", r.page >= pages ? "disabled" : "")}</div>`;
}

async function startSessionModal(campaignId) {
  const [maps, list] = await Promise.all([
    api(`/campaigns/${campaignId}/maps`),
    api(`/campaigns/${campaignId}/sessions?page=1`),
  ]);
  const next = (list.items[0]?.number || 0) + 1;
  const choices = maps.items;
  const firstTileset = choices.find((m) => m.kind === "tileset") || choices[0];
  modal(
    "✦ Iniciar nova sessão",
    `<p class="modal-lead">A campanha ficará online para os aventureiros convidados.</p><form id="start-session"><div class="field"><label for="f-title">Nome da sessão</label><div class="title-field"><span aria-hidden="true">Sessão ${String(next).padStart(2, "0")} —</span><input id="f-title" name="title" required maxlength="120" placeholder="A Cripta dos Antigos" aria-describedby="title-help"></div><small id="title-help" class="form-help">O número da sessão é atribuído automaticamente.</small></div><div class="field"><label for="f-objective">Objetivo / nota inicial do mestre</label><textarea id="f-objective" name="objective" maxlength="2000" rows="3" placeholder="Visível apenas para você no histórico da sessão."></textarea></div><fieldset class="map-choices"><legend>Mapa inicial da sessão</legend>${choices
      .map(
        (m) =>
          `<label class="map-choice"><input type="radio" name="map" value="${esc(m.kind)}|${esc(m.key)}" ${m === firstTileset ? "checked" : ""}><span class="map-preview" data-map-key="${esc(m.key)}"></span><span class="map-choice-text"><strong>${m.kind === "tileset" ? "▦ Tileset tático" : "◎ Mapa cartográfico"} · ${esc(m.name)}</strong><small>${esc(m.description)}</small></span></label>`,
      )
      .join(
        "",
      )}</fieldset><p class="notice-box">✧ Ao confirmar, a sessão será aberta e a campanha mudará para <strong>ONLINE</strong>. Os jogadores entrarão diretamente na mesa.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">▶ Iniciar sessão</button></div></form>`,
  );
  $("#modal").classList.add("wide");
  $("#modal").addEventListener(
    "close",
    () => $("#modal").classList.remove("wide"),
    { once: true },
  );
  document.querySelectorAll(".map-preview").forEach((el) =>
    mapThumbnail(
      el,
      choices.find((m) => m.key === el.dataset.mapKey),
    ),
  );
  $("#f-title").focus();
  $("#start-session").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      const [mapKind, mapKey] = String(data.map || "").split("|");
      await api(`/campaigns/${campaignId}/sessions`, "POST", {
        title: data.title,
        objective: data.objective,
        mapKind,
        mapKey,
      });
      $("#modal").close();
      toast("A campanha está online. Bem-vindo à mesa, mestre.");
      navigate("table/" + campaignId);
    });
  };
}

function resourceModal(campaignId) {
  modal(
    "Prepare a sua narrativa",
    `<form id="resource-form"><div class="field"><label for="f-kind">Tipo de recurso</label><select id="f-kind" name="kind"><option value="npc">NPC</option><option value="encontro">Encontro</option><option value="mapa">Mapa (URL de imagem HTTPS)</option><option value="nota">Nota narrativa</option></select></div><div class="field"><label for="f-rname">Nome</label><input id="f-rname" name="name" required maxlength="120"></div><div class="field"><label for="f-content">Descrição, anotações ou URL do mapa</label><textarea id="f-content" name="content" maxlength="10000" rows="4"></textarea></div><label class="check"><input type="checkbox" name="shared"> Compartilhar com os jogadores</label>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Guardar recurso</button></div></form>`,
  );
  $("#resource-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      await api(`/campaigns/${campaignId}/resources`, "POST", {
        ...data,
        shared: data.shared === "on",
      });
      $("#modal").close();
      toast("Recurso guardado.");
      await renderCampaignPage(campaignId, "resources");
    });
  };
}

async function linkModal(campaignId) {
  const mine = await api("/characters");
  if (!mine.length) {
    toast("Crie uma ficha em Personagens para vinculá-la.");
    return;
  }
  modal(
    "Leve seu herói à aventura",
    `<form id="link-form"><div class="field"><label for="f-char">Sua ficha</label><select id="f-char" name="characterId">${mine.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · Nv. ${c.level}</option>`).join("")}</select></div><p class="form-help">Nome, arquétipo, nível e vida ficam visíveis para o grupo. O mestre pode abrir a ficha completa durante a sessão.</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Vincular ficha</button></div></form>`,
  );
  $("#link-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      await api(
        `/campaigns/${campaignId}/characters/${data.characterId}`,
        "POST",
      );
      $("#modal").close();
      toast("Ficha vinculada à campanha.");
      await renderCampaignPage(campaignId, "players");
    });
  };
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action^='cp-']");
  if (!b || !location.hash.startsWith("#campaign/")) return;
  const d = state.campaign;
  const { action, id } = b.dataset;
  const reload = (tab) => renderCampaignPage(d.id, tab);
  try {
    if (action === "cp-start" && d?.isMaster) await startSessionModal(d.id);
    if (action === "cp-page") {
      page = Math.max(1, Number(id));
      await renderSessions(d, $("#campaign-tab"));
    }
    if (action === "cp-copy") {
      await navigator.clipboard.writeText(id);
      toast("Convite copiado.");
    }
    if (action === "cp-resource" && d?.isMaster) resourceModal(d.id);
    if (action === "cp-resource-delete" && d?.isMaster && isGuid(id)) {
      await api(`/campaigns/${d.id}/resources/${id}`, "DELETE");
      toast("Recurso excluído.");
      await reload("resources");
    }
    if (action === "cp-link") await linkModal(d.id);
    if (action === "cp-remove" && d?.isMaster) {
      const member = d.members.find((m) => m.id === id);
      modal(
        "Remover jogador?",
        `<p><strong>${esc(member?.name)}</strong> perderá o acesso à campanha e à mesa. As fichas pessoais são preservadas.</p><form id="remove-form">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="danger">Remover jogador</button></div></form>`,
      );
      $("#remove-form").onsubmit = (ev) => {
        ev.preventDefault();
        submitForm(ev.currentTarget, async () => {
          await api(
            `/campaigns/${d.id}/members/${encodeURIComponent(id)}`,
            "DELETE",
          );
          $("#modal").close();
          toast("Acesso do jogador removido.");
          await reload("players");
        });
      };
    }
    if (action === "cp-edit" && d?.isMaster)
      campaignForm(d, () => reload("settings"));
    if (action === "cp-delete" && d?.isMaster && !d.members.length)
      confirmCampaign({ id: d.id, name: d.name }, false, () =>
        navigate("campaigns"),
      );
  } catch (error) {
    toast(error.message);
  }
});

async function templateSettings(campaign, target) {
  const [templates, current] = await Promise.all([api(`/sheet-templates?systemId=${campaign.rpgSystemId}`), api(`/campaigns/${campaign.id}/sheet-template`)]);
  if (!target.isConnected) return;
  const section = document.createElement("section"); section.className = "metal cs-template-settings";
  section.innerHTML = `<h3>Ficha-modelo da campanha</h3><p>Novas fichas usam ${esc(current.template.name)}. Alterar esta escolha preserva as fichas existentes e suas versões.</p><form id="cp-template-form"><div class="field"><label for="cp-template">Modelo publicado do sistema</label><select id="cp-template" name="templateId"><option value="">Usar o padrão do sistema</option>${templates.map(t => `<option value="${esc(t.id)}" ${campaign.sheetTemplateId === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>${formError()}<button type="submit" class="primary">Salvar modelo da campanha</button></form>`;
  target.append(section);
  section.querySelector("form").onsubmit = event => {
    event.preventDefault(); submitForm(event.currentTarget, async data => {
      await api(`/campaigns/${campaign.id}/sheet-template`, "PUT", { templateId: data.templateId || null, revision: campaign.revision });
      toast("Modelo da campanha atualizado."); await renderCampaignPage(campaign.id, "settings");
    });
  };
}
