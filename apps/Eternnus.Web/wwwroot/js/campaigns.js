import { api } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import {
  $,
  esc,
  button,
  field,
  formError,
  submitForm,
  modal,
  toast,
  empty,
  formatDate,
} from "./ui.js";
import { campaignActions } from "./policy.js";
import { campaignRoute, isGuid } from "./session-policy.js";
let search = "",
  sort = "activity",
  generation = 0;
function row(c) {
  const actions = campaignActions(c);
  const online = !!c.activeSessionId;
  const open =
    online && !c.isMaster
      ? `<a class="button primary enter-table" href="#${campaignRoute(c)}">▶ Entrar na mesa</a>`
      : `<a class="button subtle" href="#${campaignRoute(c)}">Abrir →</a>`;
  const live =
    online && c.isMaster
      ? `<a class="button primary enter-table" href="#table/${esc(c.id)}">▶ Mesa ao vivo</a>`
      : "";
  return `<article class="campaign-row metal ${online ? "is-online" : ""}"><div class="campaign-cover" aria-hidden="true"><span>${c.isMaster ? "⚑" : "⚔"}</span></div><div class="campaign-info"><div class="campaign-name"><h2>${esc(c.name)}</h2><span class="badge ${c.isMaster ? "" : "participant"}">${c.isMaster ? "♛ Mestre" : "♟ Participante"}</span>${c.isOneShot ? '<span class="badge">One-shot</span>' : ""}${online ? '<span class="online-badge"><i aria-hidden="true"></i>ONLINE</span>' : '<span class="offline-badge">Offline</span>'}</div><div class="campaign-meta"><span>▤ ${esc(c.system)}</span><span>♧ ${c.playerCount} ${c.playerCount === 1 ? "jogador" : "jogadores"}</span><span>◷ Atualizada em ${formatDate(c.lastActivityAt)}</span></div><p>${esc(c.description || "Uma nova história aguarda seu primeiro capítulo.")}</p>${c.isOneShot ? `<p class="form-help">Dados temporários até ${formatDate(c.expiresAt)}. Ao encerrar ou sair o mestre, tudo da mesa é removido.</p>` : ""}</div><div class="campaign-row-actions">${live}${open}${actions.edit ? button("Editar", "campaign-edit", c.id, "subtle") : ""}${actions.edit ? button("Excluir", "campaign-delete", c.id, "danger", actions.delete ? "" : 'disabled title="Não disponível com jogadores vinculados"') : button("Sair", "campaign-leave", c.id, "subtle")}<small>${actions.edit && !actions.delete ? "Exclusão bloqueada: há jogadores vinculados." : online && !c.isMaster ? "Sessão em andamento: entre direto na mesa." : ""}</small></div></article>`;
}
export async function renderCampaigns() {
  shell("campaigns");
  $("#main").innerHTML =
    `<div class="page-heading"><div><span class="eyebrow">HISTÓRIAS QUE VOCÊ COMPARTILHA</span><h1>Minhas campanhas <span class="heading-gem">✦</span></h1><p>Seus mundos, sua guilda e os próximos capítulos.</p></div>${button("+ Nova campanha", "campaign-create", "", "primary")}</div><div class="campaign-toolbar"><form id="campaign-search" role="search"><label class="sr-only" for="search">Buscar campanhas</label><input id="search" name="search" maxlength="100" value="${esc(search)}" placeholder="Buscar uma campanha…"><button type="submit" class="subtle">Buscar</button></form><div class="sort-field"><label for="sort">Ordenar por</label><select id="sort"><option value="activity" ${sort === "activity" ? "selected" : ""}>Última atualização</option><option value="name" ${sort === "name" ? "selected" : ""}>Nome da campanha</option></select></div></div><div class="list-summary"><span id="campaign-count"></span>${button("Entrar por convite ↗", "campaign-join", "", "text-button")}</div><div id="campaign-list" aria-live="polite"></div><div id="pagination" class="pagination"></div>`;
  $("#campaign-search").onsubmit = (e) => {
    e.preventDefault();
    search = new FormData(e.currentTarget).get("search").trim();
    state.page = 1;
    load().catch((e) => toast(e.message));
  };
  $("#sort").onchange = (e) => {
    sort = e.target.value;
    state.page = 1;
    load().catch((e) => toast(e.message));
  };
  await load();
}
export function limitText(limits) {
  return limits.unlimited
    ? `${limits.activeCampaigns} campanhas ativas. Sua conta de equipe não tem limites de campanhas ou one-shots.`
    : `${limits.activeCampaigns}/3 campanhas ativas (mestrando + participando). ${limits.oneShotParticipations}/10 participações vitalícias em one-shots. Níveis não ampliam estes limites; embaixadores não têm limite.`;
}
async function load() {
  const request = ++generation;
  const result = await api(
    "/campaigns?" + new URLSearchParams({ search, sort, page: state.page }),
  );
  if (request !== generation || !$("#campaign-list")) return;
  state.campaigns = result.items;
  state.total = result.total;
  let limits = $("#campaign-limits");
  if (!limits) {
    limits = document.createElement("p");
    limits.id = "campaign-limits";
    limits.className = "form-help";
    $(".campaign-toolbar").before(limits);
  }
  limits.textContent = limitText(result.limits);
  $("#campaign-count").textContent =
    `${result.total} ${result.total === 1 ? "campanha encontrada" : "campanhas encontradas"}`;
  $("#campaign-list").innerHTML = result.items.length
    ? result.items.map(row).join("")
    : empty(
        search
          ? "Nenhuma história com esse nome."
          : "Toda jornada tem um começo.",
        search
          ? "Tente outra busca ou limpe o campo para ver suas campanhas."
          : "Crie sua primeira campanha ou entre com um código de convite.",
        "campaign-create",
        "+ Criar minha campanha",
      );
  $("#pagination").innerHTML =
    result.total > 20
      ? `${button("← Anterior", "campaign-page", state.page - 1, "subtle", state.page === 1 ? "disabled" : "")}<span>Página ${state.page} de ${Math.ceil(result.total / 20)}</span>${button("Próxima →", "campaign-page", state.page + 1, "subtle", state.page * 20 >= result.total ? "disabled" : "")}`
      : "";
}
const FREE_SYSTEM_ID = "00000000-0000-4000-8000-000000000001";
/** Escolhe o sistema selecionado: id da campanha, nome (sem diferenciar maiúsculas) ou Sistema livre. "keep" mantém um sistema inativo. */
export function systemChoice(systems, campaign) {
  const byId = systems.find((s) => campaign?.rpgSystemId && s.id === campaign.rpgSystemId);
  if (byId) return byId.id;
  const name = String(campaign?.system || "").trim().toLowerCase();
  const byName = name && systems.find((s) => s.name.toLowerCase() === name);
  if (byName) return byName.id;
  if (campaign) return "keep";
  return systems.find((s) => s.id === FREE_SYSTEM_ID)?.id || systems[0]?.id || "keep";
}
function systemOptions(systems, campaign) {
  const selected = campaign ? systemChoice(systems, campaign) : "";
  const keep =
    selected === "keep"
      ? `<option value="keep" selected>${esc(campaign?.system || "Sistema livre")}${campaign ? " (atual)" : ""}</option>`
      : "";
  return (
    (campaign ? keep : '<option value="" selected>Escolha o sistema de RPG</option>') +
    systems
      .filter((s) => isGuid(s.id))
      .map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`)
      .join("")
  );
}
async function loadSystems(c) {
  const select = $("#f-system");
  const help = $("#system-help");
  if (!select) return;
  select.disabled = true;
  select.innerHTML = '<option value="keep">Carregando sistemas…</option>';
  help.textContent = "";
  try {
    const systems = await api("/rpg-systems", "GET", undefined, { background: true });
    if (!select.isConnected) return;
    select.innerHTML = systemOptions(systems, c);
    const describe = () => {
      const chosen = systems.find((s) => s.id === select.value);
      help.textContent = chosen
        ? chosen.description
        : select.value === "keep" && c
          ? "Sistema atual da campanha (não disponível para novas campanhas)."
          : "";
    };
    select.onchange = describe;
    describe();
  } catch (error) {
    if (!select.isConnected) return;
    select.innerHTML = c ? `<option value="keep">${esc(c.system)}</option>` : '<option value="">Sistemas indisponíveis</option>';
    help.innerHTML = `<span role="alert">Não foi possível carregar os sistemas. ${c ? "O sistema atual será mantido." : "Tente novamente antes de criar a campanha."}</span> ${button("Tentar novamente", "campaign-systems-retry", "", "text-button")}`;
    help.querySelector("button").onclick = () => loadSystems(c);
  } finally {
    if (select.isConnected) select.disabled = false;
  }
}
export function campaignForm(c, onDone = load) {
  modal(
    c ? "Editar campanha" : "Uma nova história",
    `<p class="muted small">Defina o essencial. O resto da lenda vocês escrevem juntos.</p><form id="campaign-form">${field("name", "Nome da campanha", c?.name || "", "text", 'required maxlength="100"')}<div class="field"><label for="f-system">Sistema de RPG</label><select id="f-system" name="rpgSystemId" aria-describedby="system-help"></select><small id="system-help" class="muted small" aria-live="polite"></small></div><div class="field"><label for="description">Premissa e narrativa</label><textarea id="description" name="description" maxlength="5000" rows="4">${esc(c?.description || "")}</textarea></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">${c ? "Salvar alterações" : "Criar campanha"}</button></div></form>`,
  );
  loadSystems(c);
  $("#f-system").required = true;
  if (!c) {
    const choice = document.createElement("div");
    choice.className = "field";
    choice.innerHTML = '<label for="f-kind">Tipo de mesa</label><select id="f-kind" name="isOneShot" aria-describedby="one-shot-help"><option value="false">Campanha persistente</option><option value="true">One-shot</option></select><p id="one-shot-help" class="form-help">One-shots duram até 72 horas desde a criação. Ao encerrar a sessão, sair o mestre ou ficar sem presença dele por 45 segundos, todo conteúdo da mesa é apagado. Fichas pessoais são preservadas. A criação ou primeira entrada consome uma das 10 participações da conta comum, sem devolução.</p>';
    $("#campaign-form .form-actions").before(choice);
  }
  $("#campaign-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      const select = $("#f-system");
      const chosen = isGuid(data.rpgSystemId) ? data.rpgSystemId : null;
      if (!chosen && !c) throw new Error("Escolha um sistema de RPG antes de criar a campanha.");
      await api("/campaigns" + (c ? "/" + c.id : ""), c ? "PUT" : "POST", {
        name: data.name,
        description: data.description,
        // rpgSystemId é a escolha; o nome segue junto por compatibilidade (e mantém um sistema inativo na edição).
        rpgSystemId: chosen,
        system: chosen ? select.selectedOptions[0]?.textContent || "" : c?.system || "Sistema livre",
        revision: c?.revision || 0,
        isOneShot: c?.isOneShot || data.isOneShot === "true",
      });
      $("#modal").close();
      toast(
        c
          ? "Campanha atualizada."
          : "Seu mundo está pronto para a primeira história.",
      );
      await onDone();
    });
  };
}
export function confirmCampaign(c, leave, onDone = load) {
  modal(
    leave ? "Deixar esta aventura?" : "Encerrar esta história?",
    `<p>${leave ? "Você deixará de ter acesso a" : "Você excluirá a campanha"} <strong>${esc(c.name)}</strong>.</p><p class="muted small">${leave ? "Suas fichas pessoais serão preservadas. Para voltar, será necessário um convite." : "Sessões, mensagens e recursos da campanha serão apagados. Suas fichas pessoais serão preservadas. Esta ação não pode ser desfeita."}</p><form id="confirm-campaign">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="${leave ? "primary" : "danger"}">${leave ? "Sair da campanha" : "Excluir campanha"}</button></div></form>`,
  );
  $("#confirm-campaign").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      await api(
        "/campaigns/" + c.id + (leave ? "/leave" : ""),
        leave ? "POST" : "DELETE",
      );
      $("#modal").close();
      toast(leave ? "Você saiu da campanha." : "Campanha excluída.");
      await onDone();
    });
  };
}
export function installCampaigns() {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-action]");
    if (
      !b?.dataset.action.startsWith("campaign-") ||
      !location.hash.startsWith("#campaigns")
    )
      return;
    const { action, id } = b.dataset;
    try {
      const c = state.campaigns.find((c) => c.id === id);
      if (action === "campaign-create") campaignForm();
      if (action === "campaign-edit" && c?.isMaster) campaignForm(c);
      if (action === "campaign-delete" && c?.canDelete)
        confirmCampaign(c, false);
      if (action === "campaign-leave" && c && !c.isMaster)
        confirmCampaign(c, true);
      if (action === "campaign-page") {
        state.page = Number(id);
        await load();
      }
      if (action === "campaign-join") {
        modal(
          "Seu lugar à mesa",
          `<form id="join-form">${field("code", "Código de convite", "", "text", 'required minlength="32" maxlength="32"')}${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Entrar na campanha</button></div></form>`,
        );
        $("#join-form").onsubmit = (e) => {
          e.preventDefault();
          submitForm(e.currentTarget, async (data) => {
            await api("/campaigns/join", "POST", data);
            $("#modal").close();
            await load();
            toast("Bem-vindo à campanha.");
          });
        };
      }
      if (action === "campaign-copy") {
        await navigator.clipboard.writeText(id);
        toast("Convite copiado.");
      }
    } catch (error) {
      toast(error.message);
    }
  });
}
