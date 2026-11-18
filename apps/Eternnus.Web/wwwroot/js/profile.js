import { helpButton } from "./help.js";
import { api } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import { countMeter, storageMeter, planFacts } from "./account-usage-policy.js";
import { $, esc, field, formError, submitForm, button, toast } from "./ui.js";

function updateProfile(user) {
  state.user = user;
  for (const image of document.querySelectorAll(".avatar")) {
    image.src = user.avatarUrl;
    image.alt = "Avatar de " + user.name;
  }
  const name = $(".profile-block strong");
  if (name) name.textContent = user.name;
  $("#profile-name").textContent = user.name;
}
/** Medidores de uso: barra para quotas, contador com ∞ quando não há limite e armazenamento segmentado por tipo.
 * Larguras via CSSOM: a CSP (`style-src 'self'`) bloqueia atributos `style` na marcação. */
function usageMarkup(limits) {
  const host = document.createElement("div");
  host.className = "usage-list";
  const meters = [
    countMeter("Campanhas ativas", limits.activeCampaigns, limits.campaignLimit),
    countMeter("Participações em one-shots", limits.oneShotParticipations, limits.oneShotLimit),
    countMeter("Fichas de personagem", limits.characters, limits.characterLimit),
  ];
  const storage = storageMeter(limits.storage);
  const bar = (label, spoken, used, max, extra = "") =>
    `<div class="usage-bar${extra}" role="meter" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${Math.min(used, max)}" aria-valuetext="${esc(spoken)}">`;
  const head = (label, display) => `<div class="usage-row"><span>${esc(label)}</span><strong>${esc(display)}</strong></div>`;
  const counters = meters.map((m) => `<div class="usage-item" data-level="${m.level}">${head(m.label, m.display)}${
    m.unlimited
      ? `<p class="usage-note">Sem limite nesta conta. O contador continua para você acompanhar.</p>`
      : `${bar(m.label, m.spoken, m.used, m.limit)}<span data-share="${m.ratio}"></span></div>`
  }</div>`);
  const segments = storage.parts.filter((p) => p.bytes).map((p) => `<span class="tone-${p.tone}" data-share="${p.share}"></span>`).join("");
  const legend = storage.parts.map((p) => `<li><i class="tone-${p.tone}" aria-hidden="true"></i><span>${esc(p.label)}</span><b>${esc(p.text)}</b></li>`).join("");
  const note = "Soma o conteúdo das campanhas e one-shots que você mestra e as imagens das suas fichas. Ao chegar ao limite, novos envios ficam bloqueados; nada é apagado.";
  const plan = `<div class="usage-plan"><p class="usage-row"><span>Plano</span><strong>${esc(limits.planLabel || "Basic")}</strong></p><dl class="usage-facts">${planFacts(limits).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join("")}</dl></div>`;
  host.innerHTML = plan + counters.join("") + `<div class="usage-item" data-level="${storage.level}">${head("Armazenamento", storage.display)}${bar("Armazenamento", storage.spoken, storage.used, storage.capacity, " usage-stack")}${segments}</div><ul class="usage-legend">${legend}</ul><p class="usage-note">${note}</p></div>`;
  for (const part of host.querySelectorAll("[data-share]")) part.style.width = `${(Math.min(1, Number(part.dataset.share) || 0) * 100).toFixed(2)}%`;
  return host;
}
export async function renderProfile() {
  shell("settings");
  const user = state.user;
  $("#main").innerHTML = `<div class="page-heading"><div><span class="eyebrow">SEU LUGAR NESTE MUNDO</span><h1>Minha conta</h1></div></div><section class="account-panel metal"><img class="avatar" src="${esc(user.avatarUrl)}" alt="Seu avatar" referrerpolicy="no-referrer"><h2 id="profile-name">${esc(user.name)}</h2><p>${esc(user.email)}</p><span class="badge">${user.verified ? "Conta verificada" : "Confirmação pendente"}</span><form id="profile-form">${field("name", "Como podemos chamar você?", user.name, "text", 'required maxlength="80" autocomplete="nickname"')}${formError()}<button type="submit" class="primary">Salvar nome</button></form><form id="avatar-form"><div class="field"><div class="field-label"><label for="avatar-file">Novo avatar</label>${helpButton("conta.perfil.avatar", "Aprovação do avatar")}</div><input id="avatar-file" name="avatar" type="file" accept="image/jpeg,image/png" aria-describedby="avatar-help avatar-availability" required disabled></div><p id="avatar-help" class="form-help">JPEG ou PNG, até 2 MB. Entre 64 e 4.096 pixels por lado, até 8 milhões de pixels. A imagem será verificada antes de substituir seu avatar.</p><p class="form-help">Ao enviar, sua imagem será analisada pelo serviço externo Microsoft Azure AI Content Safety. Não envie documentos ou imagens com dados sensíveis.</p><p id="avatar-availability" class="form-help" role="status"></p>${formError()}<button type="submit" class="primary" aria-describedby="avatar-availability avatar-help" disabled>Enviar novo avatar</button></form><p class="muted small">Para alterar uma senha local, utilize a recuperação na tela de acesso.</p>${button("Sair da conta", "auth-signout", "", "subtle")} ${button("Sair de todos os dispositivos", "auth-signout-all", "", "subtle")}</section>`;
  $("#profile-form").onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async (data) => {
      updateProfile(await api("/auth/profile", "PUT", { name: data.name }));
      toast("Nome atualizado.");
    });
  };
  const limits = document.createElement("section");
  limits.className = "usage";
  limits.setAttribute("aria-labelledby", "usage-title");
  limits.setAttribute("aria-busy", "true");
  limits.innerHTML = `<div class="usage-head"><h3 id="usage-title">Uso da conta</h3>${helpButton("conta.uso.limites", "Uso da conta")}</div><p class="form-help" role="status">Consultando limites da conta…</p>`;
  $("#profile-form").before(limits);
  api("/auth/limits").then((result) => {
    if (!limits.isConnected) return;
    limits.removeAttribute("aria-busy");
    limits.querySelector("[role=status]").replaceWith(usageMarkup(result));
  }).catch(() => {
    if (!limits.isConnected) return;
    limits.removeAttribute("aria-busy");
    limits.querySelector("[role=status]").textContent = "Não foi possível consultar seus limites. Recarregue a conta para tentar novamente.";
  });
  if (user.role === "admin") {
    const security = document.createElement("p");
    security.className = "form-help";
    security.textContent = "Administrador: autenticador em duas etapas obrigatório em todos os acessos. Apenas administradores podem alterar o papel de embaixador.";
    limits.after(security);
  }
  $("#avatar-form").onsubmit = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submitForm(form, async (data) => {
      const file = data.avatar;
      if (!file || !["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024 || !file.size)
        throw new Error("Escolha uma imagem JPEG ou PNG de até 2 MB.");
      const upload = new FormData();
      upload.append("avatar", file);
      updateProfile(await api("/auth/avatar", "POST", upload));
      form.reset();
      toast("Avatar atualizado após as verificações de segurança.");
    });
  };
  const availability = $("#avatar-availability");
  try {
    const policy = await api("/auth/avatar-policy");
    if (!availability.isConnected) return;
    const enabled = user.verified && policy.available;
    $("#avatar-file").disabled = !enabled;
    $("#avatar-form button[type=submit]").disabled = !enabled;
    availability.textContent = !user.verified ? "Confirme seu e-mail para enviar um avatar." : !policy.available ? "Envio indisponível: a verificação de segurança ainda não está configurada." : "Imagens com conteúdo sexual, violência, ódio ou automutilação serão recusadas pela análise automática. Se uma verificação falhar, seu avatar atual será mantido.";
  } catch {
    if (availability.isConnected) availability.textContent = "Não foi possível consultar a disponibilidade do envio. Recarregue para tentar novamente.";
  }
}
