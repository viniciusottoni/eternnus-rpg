import { helpButton } from "./help.js";
// Página One-shot (#one-shot): mesas rápidas. Criar uma one-shot já abre sua sessão única; não existe "iniciar sessão".
// Apresentação apenas: quotas, prazo de 72 h e presença do mestre são validados no servidor.
import { api } from "./api.js";
import { shell } from "./layout.js";
import { $, esc, button, field, formError, submitForm, modal, toast, empty, formatDate, navigate } from "./ui.js";
import { loadSystems, limitText } from "./campaigns.js";
import { isGuid } from "./session-policy.js";

const RULES =
  "A sessão é única e abre na criação. A mesa dura até 72 horas. Se o mestre se desconectar, ela espera alguns minutos para ele voltar; encerrar a sessão apaga todo o conteúdo. Para continuar outro dia, converta em campanha. Fichas pessoais são preservadas. A criação ou primeira entrada consome uma das 10 participações da conta comum, sem devolução.";
let page = 1,
  generation = 0,
  items = [];

function row(c) {
  const online = !!c.activeSessionId;
  const enter = online
    ? `<a class="button primary enter-table" href="#table/${esc(c.id)}">▶ ${c.isMaster ? "Voltar à mesa" : "Entrar na mesa"}</a>`
    : "";
  const prepare = c.isMaster ? `<a class="button subtle" href="#campaign/${esc(c.id)}">Preparar →</a>${button("Converter em campanha", "os-convert", c.id, "subtle")}` : "";
  const close = c.isMaster
    ? online
      ? button("Encerrar", "os-end", c.id, "danger")
      : button("Excluir", "os-delete", c.id, "danger")
    : button("Sair", "os-leave", c.id, "subtle");
  return `<article class="campaign-row metal ${online ? "is-online" : ""}"><div class="campaign-cover" aria-hidden="true"><span>${c.isMaster ? "⬡" : "⚔"}</span></div><div class="campaign-info"><div class="campaign-name"><h2>${esc(c.name)}</h2><span class="badge ${c.isMaster ? "" : "participant"}" data-tip="${c.isMaster ? "Você conduz e administra esta campanha." : "Você participa como Jogador nesta campanha."}">${c.isMaster ? "♛ Mestre" : "♟ Participante"}</span>${online ? '<span class="online-badge" data-tip="Há uma sessão ativa nesta campanha."><i aria-hidden="true"></i>ONLINE</span>' : '<span class="offline-badge" data-tip="Nenhuma sessão está aberta nesta campanha.">Fechada</span>'}</div><div class="campaign-meta"><span>▤ ${esc(c.system)}</span><span>♧ ${c.playerCount} ${c.playerCount === 1 ? "jogador" : "jogadores"}</span><span>◷ Expira em ${formatDate(c.expiresAt)}</span></div><p>${esc(c.description || "Uma noite, uma história.")}</p></div><div class="campaign-row-actions">${enter}${prepare}${close}</div></article>`;
}

export async function renderOneShots() {
  shell("one-shot");
  page = 1;
  $("#main").innerHTML =
    `<div class="page-heading"><div><span class="eyebrow">UMA NOITE, UMA HISTÓRIA</span><h1>One-shot ${helpButton("campanhas.one-shot.continuidade", "One-shot e continuidade")}<span class="heading-gem" aria-hidden="true">⬡</span></h1><p>Mesa rápida: crie, convide e jogue. A sessão abre junto com a mesa.</p></div>${button("+ Nova one-shot", "os-create", "", "primary")}</div><p id="os-limits" class="form-help"></p>${helpButton("campanhas.conta.limites", "Limites da conta")}<div class="list-summary"><span id="os-count"></span>${button("Entrar por convite ↗", "os-join", "", "text-button")}</div><div id="os-list" aria-live="polite"><p class="loading-line" role="status">Reunindo as mesas…</p></div><div id="os-pagination" class="pagination"></div>`;
  $("#main").addEventListener("click", onClick);
  await load();
}

async function load() {
  const request = ++generation;
  const list = $("#os-list");
  let result;
  try {
    result = await api("/campaigns?" + new URLSearchParams({ oneShot: true, page }));
  } catch (error) {
    if (request === generation && list?.isConnected)
      list.innerHTML = `<p role="alert" class="form-error">Não foi possível carregar as one-shots. ${esc(error.message)}</p>${button("Tentar novamente", "os-retry", "", "subtle")}`;
    return;
  }
  if (request !== generation || !list?.isConnected) return;
  items = result.items;
  $("#os-limits").textContent = limitText(result.limits);
  $("#os-count").textContent = `${result.total} ${result.total === 1 ? "one-shot ativa" : "one-shots ativas"}`;
  list.innerHTML = items.length
    ? items.map(row).join("")
    : empty("Nenhuma mesa rápida aberta.", "Crie uma one-shot e a sessão começa na hora, ou entre com um código de convite.", "os-create", "+ Criar one-shot");
  $("#os-pagination").innerHTML =
    result.total > result.pageSize
      ? `${button("← Anterior", "os-page", page - 1, "subtle", page === 1 ? "disabled" : "")}<span>Página ${page} de ${Math.ceil(result.total / result.pageSize)}</span>${button("Próxima →", "os-page", page + 1, "subtle", page * result.pageSize >= result.total ? "disabled" : "")}`
      : "";
}

function createModal() {
  modal(
    "Nova one-shot",
    `<p class="muted small">Uma mesa rápida para jogar agora.</p><form id="one-shot-form">${field("name", "Nome da one-shot", "", "text", 'required maxlength="100"')}<div class="field"><label for="f-system">Sistema de RPG</label><select id="f-system" name="rpgSystemId" required aria-describedby="system-help"></select><small id="system-help" class="muted small" aria-live="polite"></small></div><div class="field"><label for="description">Premissa</label><textarea id="description" name="description" maxlength="10000" rows="3"></textarea></div><p class="notice-box">${RULES}</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">▶ Abrir one-shot</button></div></form>`,
  );
  loadSystems();
  $("#one-shot-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      const select = $("#f-system");
      if (!isGuid(data.rpgSystemId)) throw new Error("Escolha um sistema de RPG antes de abrir a one-shot.");
      const created = await api("/one-shots", "POST", {
        name: data.name,
        description: data.description,
        rpgSystemId: data.rpgSystemId,
        system: select.selectedOptions[0]?.textContent || "",
      });
      $("#modal").close();
      toast("Mesa aberta. Compartilhe o convite na página de preparo.");
      navigate("table/" + created.campaignId);
    });
  };
}

function joinModal() {
  modal(
    "Seu lugar à mesa",
    `<form id="os-join-form">${field("code", "Código de convite", "", "text", 'required minlength="32" maxlength="32"')}<p class="form-help">${RULES}</p>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Entrar na one-shot</button></div></form>`,
  );
  $("#os-join-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      const joined = await api("/campaigns/join", "POST", data);
      $("#modal").close();
      toast("Bem-vindo à mesa.");
      navigate("table/" + joined.id);
    });
  };
}

function confirmModal(c, kind) {
  const copy = {
    end: ["Encerrar a one-shot?", "A sessão única será encerrada e todo o conteúdo da mesa será apagado. Fichas pessoais e a participação consumida são preservadas.", "■ Encerrar e apagar", "danger"],
    delete: ["Excluir a one-shot?", "A mesa e seus recursos serão apagados. Fichas pessoais e a participação consumida são preservadas.", "Excluir one-shot", "danger"],
    convert: ["Converter em campanha?", "Sessão, fichas, mapas e histórico são preservados. A campanha passa a usar uma das suas vagas; jogadores que já estiverem no limite saem da mesa e podem voltar pelo convite.", "Converter em campanha", "primary"],
    leave: ["Deixar esta mesa?", "Você perderá o acesso. Reentrar pelo mesmo convite não consome outra participação.", "Sair da one-shot", "primary"],
  }[kind];
  modal(copy[0], `<p><strong>${esc(c.name)}</strong></p><p class="muted small">${copy[1]}</p><form id="os-confirm">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="${copy[3]}">${copy[2]}</button></div></form>`);
  $("#os-confirm").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async () => {
      if (kind === "end") await api(`/sessions/${c.activeSessionId}/end`, "POST");
      if (kind === "delete") await api("/campaigns/" + c.id, "DELETE");
      if (kind === "leave") await api(`/campaigns/${c.id}/leave`, "POST");
      if (kind === "convert") {
        const r = await api(`/campaigns/${c.id}/convert`, "POST");
        $("#modal").close();
        toast(r.removed ? `Campanha criada. ${r.removed} jogador(es) sem vaga ficaram de fora.` : "Campanha criada. Tudo foi preservado.");
        return navigate(`campaign/${c.id}`);
      }
      $("#modal").close();
      toast(kind === "leave" ? "Você saiu da one-shot." : "One-shot encerrada. Os dados da mesa foram removidos.");
      await load();
    });
  };
}

async function onClick(e) {
  const b = e.target.closest("[data-action]");
  if (!b?.dataset.action.startsWith("os-")) return;
  const { action, id } = b.dataset;
  const c = items.find((x) => x.id === id);
  try {
    if (action === "os-create") createModal();
    if (action === "os-join") joinModal();
    if (action === "os-retry") await load();
    if (action === "os-page") {
      page = Math.max(1, Number(id) || 1);
      await load();
    }
    if (action === "os-end" && c?.isMaster && isGuid(c.activeSessionId)) confirmModal(c, "end");
    if (action === "os-delete" && c?.isMaster) confirmModal(c, "delete");
    if (action === "os-leave" && c && !c.isMaster) confirmModal(c, "leave");
    if (action === "os-convert" && c?.isMaster) confirmModal(c, "convert");
  } catch (error) {
    toast(error.message);
  }
}
