import { helpButton } from "./help.js";
import { beginLoading } from "./loading.js";
import { api, renewCsrf, clearCsrf } from "./api.js";
import { state } from "./state.js";
import { safeReturnRoute } from "./policy.js";
import { installButton } from "./pwa.js";
import {
  $,
  esc,
  button,
  field,
  passwordField,
  formError,
  submitForm,
  toast,
  navigate,
  modal,
} from "./ui.js";
let mode = "login";
export function takeReturnRoute() {
  try {
    const value = sessionStorage.getItem("eternnus.return-route");
    sessionStorage.removeItem("eternnus.return-route");
    return value ? safeReturnRoute(value) : null;
  } catch { return null; }
}
async function completeSignIn() {
  await refreshUser();
  await renewCsrf();
  const stored = takeReturnRoute();
  const destination = safeReturnRoute(stored || state.returnRoute);
  state.returnRoute = null;
  state.sessionExpired = false;
  history.replaceState(null, "", "/#" + destination);
  navigate(destination);
}
async function finishSignOut(all = false) {
  await api(all ? "/auth/logout-all" : "/auth/logout", "POST");
  state.user = null;
  state.campaign = state.liveTable = null;
  state.campaigns = []; state.characters = [];
  state.returnRoute = null; state.sessionExpired = false;
  try { sessionStorage.removeItem("eternnus.return-route"); } catch { /* Opcional. */ }
  clearCsrf();
  navigate("login");
  await renewCsrf();
  if (all) toast("Acessos encerrados em todos os dispositivos. Entre novamente para continuar.");
}
async function renderAuthenticator() {
  const setup = await api("/auth/two-factor/setup");
  const form = $("#auth-form");
  if (!form) return;
  form.innerHTML = `<h2>${setup.setupRequired ? "Configure seu autenticador" : "Confirme seu acesso"}</h2>${helpButton("conta.acesso.autenticador", "Autenticador")}<p class="form-help">Administradores precisam de autenticação em duas etapas. Este desafio expira em cinco minutos.</p>${setup.setupRequired ? `<p class="form-help">No seu aplicativo autenticador, adicione uma conta com chave manual: emissor Eternnus RPG, conta ${esc(setup.account)}, chave abaixo e códigos por tempo (TOTP).</p>${field("sharedKey", "Chave do autenticador", setup.sharedKey, "text", 'readonly autocomplete="off" spellcheck="false"')}<p class="form-help">Guarde a chave em local privado e informe o código gerado para ativar a proteção.</p>` : ""}${field("code", "Código do autenticador", "", "text", `maxlength="20" inputmode="numeric" autocomplete="one-time-code" ${setup.setupRequired ? "required" : ""}`)}${!setup.setupRequired ? field("recoveryCode", "Ou um código de recuperação", "", "text", 'maxlength="100" autocomplete="off"') : ""}${formError()}<button type="submit" class="primary auth-submit">${setup.setupRequired ? "Ativar e entrar" : "Confirmar e entrar"}</button>`;
  form.onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async (data) => {
      const result = await api("/auth/two-factor/verify", "POST", { code: data.code || null, recoveryCode: data.recoveryCode || null });
      await renewCsrf();
      if (result.recoveryCodes?.length) {
        form.innerHTML = `<h2>Guarde seus códigos de recuperação</h2><p class="form-help">Cada código funciona uma única vez caso você perca o autenticador. Copie para um local privado. Eles não serão exibidos novamente.</p><pre>${result.recoveryCodes.map(esc).join("\n")}</pre><button type="button" id="mfa-continue" class="primary auth-submit">Guardei os códigos. Continuar</button>`;
        $("#mfa-continue").onclick = () => completeSignIn().catch((error) => toast(error.message));
      } else await completeSignIn();
    });
  };
  $("#f-code")?.focus();
}
export async function refreshUser() {
  try {
    state.user = await api("/auth/me");
  } catch (e) {
    if (e.status !== 401) throw e;
    state.user = null;
  }
  return state.user;
}
function sso() {
  return `<div class="field-label"><span>Acesso social</span>${helpButton("conta.acesso.social", "Acesso com Google ou Discord")}</div><div class="sso-buttons">${["google", "discord"].map((p) => button(`<span class="provider-icon ${p}" aria-hidden="true">${p === "google" ? "G" : "◉"}</span>Continuar com ${p === "google" ? "Google" : "Discord"}`, "auth-sso", p, "sso", state.providers[p] ? "" : 'aria-disabled="true" data-tip="Indisponível no momento" aria-describedby="sso-unavailable"')).join("")}</div>${!state.providers.google || !state.providers.discord ? '<p id="sso-unavailable" class="integration-hint">Acesso social indisponível no momento. Você pode usar seu e-mail e senha.</p>' : ""}`;
}
export function renderAuth(nextMode = "login") {
  mode = nextMode;
  $("#app").className = "auth-screen";
  const register = mode === "register",
    reset = mode === "reset",
    forgot = mode === "forgot";
  const title = reset
    ? "Uma nova chave."
    : forgot
      ? "Retome sua jornada."
      : register
        ? "Sua lenda começa aqui."
        : "Seu lugar à mesa espera.";
  const forms = reset
    ? `${passwordField("password", "Nova senha", "new-password", { hint: "Use de 10 a 128 caracteres, com maiúscula, minúscula, número e símbolo." })}${passwordField("confirmPassword", "Confirme a nova senha", "new-password")}`
    : forgot
      ? field(
          "email",
          "E-mail da sua conta",
          "",
          "email",
          'required maxlength="200" autocomplete="email"',
        )
      : `${register ? field("name", "Como podemos chamar você?", "", "text", 'required maxlength="80" autocomplete="nickname"') : ""}${field("email", "E-mail", "", "email", 'required maxlength="200" autocomplete="username"')}${passwordField("password", "Senha", register ? "new-password" : "current-password", { hint: register ? "Use de 10 a 128 caracteres, com maiúscula, minúscula, número e símbolo." : "" })}${register ? passwordField("confirmPassword", "Confirme a senha", "new-password") : ""}`;
  $("#app").innerHTML =
    `<header class="auth-header"><span>✦</span><p>UM UNIVERSO DE HISTÓRIAS</p><span>✦</span><div class="music-dock"></div></header><main class="auth-main"><a class="auth-brand" href="#login"><img src="/assets/eternnus-logo.webp" alt="Eternnus RPG"></a><p class="auth-tagline">Forje a sua lenda.</p><section class="auth-panel metal"><div class="panel-gem" aria-hidden="true">◆</div>${!forgot && !reset ? `<div class="auth-tabs" role="tablist" aria-label="Acesso à conta"><button role="tab" aria-selected="${!register}" data-action="auth-mode" data-id="login">Entrar</button><button role="tab" aria-selected="${register}" data-action="auth-mode" data-id="register">Cadastrar-se</button></div>` : ""}<div class="auth-panel-body"><span class="eyebrow">${register ? "SEU PRIMEIRO CAPÍTULO" : reset ? "RENOVE SEU ACESSO" : forgot ? "RECUPERAÇÃO DE CONTA" : "BEM-VINDO AO ETERNNUS"}</span><h1>${title}</h1>${register ? sso() + '<div class="divider"><span>ou cadastre-se com e-mail</span></div>' : ""}<form id="auth-form">${forms}${!register && !forgot && !reset ? '<label class="remember-login" for="f-rememberMe"><input id="f-rememberMe" name="rememberMe" type="checkbox" aria-describedby="remember-help"><span>Manter conectado por 14 dias</span></label>' + helpButton("conta.acesso.persistencia", "Manter conectado") + '<p id="remember-help" class="form-help">Use apenas em um dispositivo pessoal. Administradores entram por até 8 horas.</p>' : ""}${register || reset ? '<p class="form-help">Use de 10 a 128 caracteres, com maiúscula, minúscula, número e símbolo.</p>' : ""}${mode === "login" ? `<div class="forgot-row">${button("Esqueci minha senha", "auth-mode", "forgot", "text-button")}</div>` : ""}${formError()}<button type="submit" class="primary auth-submit">${reset ? "Salvar nova senha" : forgot ? "Enviar link de recuperação" : register ? "Criar minha conta" : "Entrar no reino"} <span>→</span></button></form>${mode === "login" ? '<div class="divider"><span>ou continue com</span></div>' + sso() : ""}${forgot || reset ? button("← Voltar para entrar", "auth-mode", "login", "text-button back-link") : ""}${register ? '<p class="form-help avatar-notice"><img src="/assets/avatar.svg" alt="Avatar padrão">Um avatar de aventureiro acompanhará você. Contas com e-mail precisam de confirmação.</p>' : ""}<div id="auth-notice" class="auth-notice" role="status"></div></div></section><p class="auth-footnote">✧ &nbsp; Suas histórias guardadas. Seu próximo capítulo à espera.</p></main><footer class="auth-footer"><span>ETERNNUS RPG</span><span>Suas escolhas. Seu destino.</span>${installButton()}</footer>`;
  $("#auth-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (data) => {
      if ((register || reset) && data.password !== data.confirmPassword)
        throw new Error("As senhas precisam ser iguais.");
      if (register) {
        await api("/auth/register", "POST", data);
        await refreshUser();
        await renewCsrf();
        navigate("overview");
      } else if (forgot) {
        const r = await api("/auth/forgot-password", "POST", data);
        $("#auth-notice").textContent = r.message;
      } else if (reset) {
        const params = new URLSearchParams(location.search);
        const r = await api("/auth/reset-password", "POST", {
          ...data,
          userId: params.get("userId"),
          code: params.get("code"),
        });
        state.user = null;
        await renewCsrf();
        history.replaceState(null, "", "/#login");
        renderAuth();
        $("#auth-notice").textContent = r.message;
      } else {
        const result = await api("/auth/login", "POST", { ...data, rememberMe: data.rememberMe === "on" });
        if (result?.requiresTwoFactor) await renderAuthenticator();
        else await completeSignIn();
      }
    });
  };
  if (mode === "login" && state.sessionExpired) {
    $("#auth-notice").textContent = "Seu acesso expirou ou foi encerrado. Entre novamente para voltar à tela anterior. Ações interrompidas não serão reenviadas.";
    $("#f-email")?.focus();
  }
  if (mode === "login" && new URLSearchParams(location.search).get("twoFactor") === "1") {
    history.replaceState(null, "", "/#login");
    renderAuthenticator().catch((error) => { const notice = $("#auth-notice"); if (notice) notice.textContent = error.message; });
  }
}
export function installAuth() {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    try {
      if (b.dataset.action === "auth-mode") {
        if (new URLSearchParams(location.search).get("flow") === "reset")
          history.replaceState(null, "", "/#login");
        renderAuth(b.dataset.id);
      }
      if (b.dataset.action === "auth-sso" && !b.disabled) {
        if (!["google", "discord"].includes(b.dataset.id)) return;
        const finish = beginLoading();
        try {
          try { sessionStorage.setItem("eternnus.return-route", safeReturnRoute(state.returnRoute)); } catch { /* Opcional. */ }
          const remember = $("#f-rememberMe")?.checked === true;
          location.assign("/api/auth/external/" + b.dataset.id + "?rememberMe=" + remember);
          window.addEventListener("pageshow", finish, { once: true });
        } catch (error) {
          finish();
          throw error;
        }
      }
      if (b.dataset.action === "auth-signout") {
        b.disabled = true;
        await finishSignOut();
      }
      if (b.dataset.action === "auth-signout-all") {
        modal("Sair de todos os dispositivos", `<p>Seu acesso será encerrado aqui e nos outros dispositivos na próxima requisição. Você precisará entrar novamente, inclusive pelo autenticador quando exigido.</p><form id="logout-all-form">${formError()}<div class="form-actions">${button("Voltar", "modal-close", "", "subtle")}<button type="submit" class="danger">Sair de todos os dispositivos</button></div></form>`);
        $("#logout-all-form").onsubmit = (event) => {
          event.preventDefault();
          submitForm(event.currentTarget, () => finishSignOut(true));
        };
      }
      if (b.dataset.action === "auth-resend") {
        b.disabled = true;
        const result = await api("/auth/resend", "POST");
        state.mailHint = result.message;
        toast(result.message);
        const hint = $(".delivery-hint");
        if (hint) hint.textContent = result.message;
        setTimeout(() => {
          if (b.isConnected) b.disabled = false;
        }, 60000);
      }
      if (b.dataset.action === "auth-refresh") {
        await refreshUser();
        if (state.user?.verified) {
          state.mailHint = "";
          toast("E-mail confirmado. A aventura está liberada.");
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } else
          toast(
            "A confirmação ainda não foi concluída. Abra o link enviado por e-mail.",
          );
      }
    } catch (error) {
      toast(error.message);
      b.disabled = false;
    }
  });
}
