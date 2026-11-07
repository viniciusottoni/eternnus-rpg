import { api } from "./api.js";
import { state } from "./state.js";
import { shell } from "./layout.js";
import { limitText } from "./campaigns.js";
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
export async function renderProfile() {
  shell("settings");
  const user = state.user;
  $("#main").innerHTML = `<div class="page-heading"><div><span class="eyebrow">SEU LUGAR NESTE MUNDO</span><h1>Minha conta</h1></div></div><section class="account-panel metal"><img class="avatar" src="${esc(user.avatarUrl)}" alt="Seu avatar" referrerpolicy="no-referrer"><h2 id="profile-name">${esc(user.name)}</h2><p>${esc(user.email)}</p><span class="badge">${user.verified ? "Conta verificada" : "Confirmação pendente"}</span><form id="profile-form">${field("name", "Como podemos chamar você?", user.name, "text", 'required maxlength="80" autocomplete="nickname"')}${formError()}<button type="submit" class="primary">Salvar nome</button></form><form id="avatar-form"><div class="field"><label for="avatar-file">Novo avatar</label><input id="avatar-file" name="avatar" type="file" accept="image/jpeg,image/png" aria-describedby="avatar-help avatar-availability" required disabled></div><p id="avatar-help" class="form-help">JPEG ou PNG, até 2 MB. Entre 64 e 4.096 pixels por lado, até 8 milhões de pixels. A imagem será verificada antes de substituir seu avatar.</p><p class="form-help">Ao enviar, sua imagem será analisada pelo serviço externo Microsoft Azure AI Content Safety. Não envie documentos ou imagens com dados sensíveis.</p><p id="avatar-availability" class="form-help" role="status"></p>${formError()}<button type="submit" class="primary" disabled>Enviar novo avatar</button></form><p class="muted small">Para alterar uma senha local, utilize a recuperação na tela de acesso.</p>${button("Sair da conta", "auth-signout", "", "subtle")}</section>`;
  $("#profile-form").onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async (data) => {
      updateProfile(await api("/auth/profile", "PUT", { name: data.name }));
      toast("Nome atualizado.");
    });
  };
  const limits = document.createElement("p");
  limits.className = "form-help";
  limits.setAttribute("role", "status");
  limits.textContent = "Consultando limites da conta…";
  $("#profile-form").before(limits);
  api("/auth/limits").then((result) => {
    if (limits.isConnected) limits.textContent = limitText(result);
  }).catch(() => { if (limits.isConnected) limits.textContent = "Não foi possível consultar seus limites. Recarregue a conta para tentar novamente."; });
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
