import { $, modal, toast } from "./ui.js";
let promptEvent = null;
const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true;
export function installButton() {
  return standalone()
    ? ""
    : '<button type="button" class="install-app subtle" data-action="pwa-install" aria-label="Instalar Eternnus RPG">↓ Instalar app</button>';
}
export function updateConnection() {
  const banner = $("#connection-banner");
  if (!banner) return;
  banner.hidden = navigator.onLine;
  banner.textContent = navigator.onLine
    ? ""
    : "Você está sem conexão. Entre na internet para acessar sua conta e salvar alterações.";
}
export function installPwa() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    promptEvent = event;
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    document
      .querySelectorAll('[data-action="pwa-install"]')
      .forEach((b) => b.remove());
    toast("Eternnus RPG instalado. Sua próxima aventura está a um toque.");
  });
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);
  updateConnection();
  document.addEventListener("click", async (event) => {
    if (!event.target.closest('[data-action="pwa-install"]')) return;
    if (promptEvent) {
      const current = promptEvent;
      promptEvent = null;
      await current.prompt();
      await current.userChoice;
      return;
    }
    modal(
      "Leve sua aventura com você",
      `<p>Instale o Eternnus RPG diretamente pelo navegador, sem uma loja.</p><p><strong>No iPhone ou iPad:</strong> abra no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.</p><p><strong>No Android ou computador:</strong> abra o menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”, quando disponível.</p><p class="form-help">A disponibilidade depende do navegador. O site precisa estar em HTTPS. Acesso à conta e alterações exigem conexão.</p>`,
    );
  });
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register("/service-worker.js", {
        type: "module",
        scope: "/",
        updateViaCache: "none",
      })
      .catch(() => {
        /* Browser use remains available if offline installation is unavailable. */
      });
  }
}
