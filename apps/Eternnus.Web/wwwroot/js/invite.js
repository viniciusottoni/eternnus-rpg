// Convite por link (#invite/{código}): prévia → entrar → personagem → mesa. Carregado sob demanda.
// A conta precisa estar verificada; antes disso, o código fica guardado no servidor (sem conceder acesso).
import { api } from "./api.js";
import { shell } from "./layout.js";
import { $, esc, button, formError, submitForm, toast, navigate } from "./ui.js";

export async function renderInvite(code) {
  shell("campaigns");
  $("#main").innerHTML = '<p class="loading-line" role="status">Conferindo o convite…</p>';
  let invite;
  try {
    invite = await api(`/invites/${encodeURIComponent(code)}`);
  } catch (error) {
    $("#main").innerHTML = `<section class="invite-page metal"><h1>Convite indisponível</h1><p>${esc(error.message)}</p><p class="small">Peça ao mestre um novo link ou entre com o código na página Campanhas.</p><a class="button primary" href="#campaigns">Ir para Campanhas</a></section>`;
    api("/invites/pending", "DELETE", undefined, { background: true }).catch(() => {});
    return;
  }
  const target = invite.member && invite.online ? `table/${invite.campaignId}` : `campaign/${invite.campaignId}`;
  if (invite.member) {
    api("/invites/pending", "DELETE", undefined, { background: true }).catch(() => {});
    $("#main").innerHTML = `<section class="invite-page metal"><span class="eyebrow">${esc(invite.system)}</span><h1>${esc(invite.name)}</h1><p>Você já faz parte desta ${invite.isOneShot ? "one-shot" : "campanha"}.</p><a class="button primary" href="#${esc(target)}">${invite.online ? "▶ Entrar na mesa" : "Abrir campanha"}</a></section>`;
    return;
  }
  const blocked = invite.archived ? "Esta campanha está arquivada e não recebe novos jogadores no momento." : invite.expired ? "Esta one-shot já foi encerrada." : "";
  $("#main").innerHTML = `<section class="invite-page metal"><span class="eyebrow">CONVITE · ${esc(invite.system)}</span><h1>${esc(invite.name)}</h1><dl class="invite-facts"><div><dt>Mestre</dt><dd>${esc(invite.master)}</dd></div><div><dt>Forma de jogar</dt><dd>${esc(invite.playModeLabel)}</dd></div><div><dt>Estado</dt><dd>${invite.online ? '<span class="online-badge" data-tip="Há uma sessão ativa nesta campanha."><i aria-hidden="true"></i>Mesa aberta agora</span>' : "Mesa fechada no momento"}</dd></div></dl>${invite.isOneShot ? '<p class="small">One-shot: entrar consome uma das participações da sua conta (reentrar pelo mesmo convite não consome outra).</p>' : '<p class="small">Entrar usa uma das vagas de campanha da sua conta.</p>'}${blocked ? `<p class="notice-box">${esc(blocked)}</p>` : `<form id="invite-join">${formError()}<div class="form-actions"><a class="button subtle" href="#overview">Agora não</a><button type="submit" class="primary">Entrar ${invite.isOneShot ? "na one-shot" : "na campanha"}</button></div></form>`}<p class="small muted">Depois de entrar, você escolhe ou cria o personagem com o modelo da campanha.</p></section>`;
  const form = $("#invite-join");
  if (form)
    form.onsubmit = (e) => {
      e.preventDefault();
      submitForm(form, async () => {
        await api("/campaigns/join", "POST", { code });
        toast(`Bem-vindo a ${invite.name}.`);
        // Personagem → mesa: a mesa já oferece escolher ou criar a ficha; sem mesa aberta, a campanha mostra o caminho.
        navigate(invite.online ? `table/${invite.campaignId}` : `campaign/${invite.campaignId}/overview`);
      });
    };
}

/** Guarda o convite enquanto a conta confirma o e-mail (outra aba ou outro dia). */
export async function keepPendingInvite(code) {
  try { await api("/invites/pending", "POST", { code }, { background: true }); } catch { /* opcional */ }
}
