// Imagem do personagem (ADR-097): cartão ao lado da ficha, fora do PDF. Envio e remoção só do dono; leitura segue a ficha.
import { api } from "./api.js";
import { $, esc, button, iconButton, modal, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { mountImageZoom } from "./image-zoom.js";
import { portraitUrl, initials, portraitFileError } from "./character-portrait-policy.js";
import { state } from "./state.js";
import { uploadLimit, formatBytes } from "./account-usage-policy.js";

/**
 * Monta o cartão em `host`. `state`: { id, name, version, canChange, fresh }. `onChange(version)` recebe a nova versão.
 * Devolve a função de descarte.
 */
export function mountCharacterPortrait(host, state, { onChange = () => {} } = {}) {
  let current = { ...state }, busy = false, dead = false;

  function render(message = "") {
    const url = portraitUrl(current.id, current.version);
    const name = esc(current.name);
    const frame = url
      ? `<button type="button" class="cs-portrait-frame" data-action="portrait-open" aria-label="Ampliar a imagem de ${name}"><span class="cs-portrait-initials" aria-hidden="true">${esc(initials(current.name))}</span><img alt="" hidden></button>`
      : `<div class="cs-portrait-frame is-empty"><span class="cs-portrait-initials" aria-hidden="true">${esc(initials(current.name))}</span></div>`;
    const controls = current.fresh
      ? `<p class="form-help">Crie o personagem para adicionar uma imagem.</p>`
      : current.canChange
        ? `<input id="cs-portrait-file" type="file" accept="image/png,image/jpeg" hidden><div class="cs-portrait-actions">${button(url ? "Trocar imagem" : "Adicionar imagem", "portrait-pick", "", "subtle")}${url ? iconButton("trash", "Remover imagem", "portrait-remove", "", "subtle danger-text") : ""}</div><p class="form-help">PNG ou JPEG, até ${formatBytes(uploadLimit(state.user))} (limite do seu plano). A imagem é reduzida para até 1.024 px e fica fora do PDF.</p>`
        : url ? "" : `<p class="form-help">Sem imagem do personagem.</p>`;
    host.innerHTML = `<div class="cs-portrait-head"><h2>Imagem do personagem</h2>${helpButton("fichas.imagem.personagem", "Imagem do personagem")}</div>${frame}<p class="cs-portrait-name">${name}</p>${controls}<p class="form-help cs-portrait-status" role="status">${esc(message)}</p>`;
    const img = host.querySelector(".cs-portrait-frame img");
    if (img) {
      img.onload = () => { img.hidden = false; host.querySelector(".cs-portrait-frame")?.classList.add("is-loaded"); };
      img.onerror = () => { if (!dead) host.querySelector(".cs-portrait-status").textContent = "Não foi possível carregar a imagem."; };
      img.src = url;
    }
    host.setAttribute("aria-busy", String(busy));
    for (const b of host.querySelectorAll("button[data-action^='portrait-']")) if (b.dataset.action !== "portrait-open") b.disabled = busy;
  }

  async function run(task, pending) {
    if (busy) return false;
    busy = true;
    render(pending);
    try {
      const result = await task();
      if (dead) return false;
      current.version = result.portraitVersion;
      busy = false;
      render();
      onChange(current.version);
      return true;
    } catch (error) {
      if (dead) return false;
      busy = false;
      render(error.message);
      return false;
    }
  }

  function upload(file) {
    const problem = portraitFileError(file, uploadLimit(state.user));
    if (problem) { render(problem); return; }
    const data = new FormData();
    data.append("file", file);
    run(() => api(`/characters/${current.id}/portrait`, "POST", data), "Enviando imagem…").then((ok) => { if (ok) toast("Imagem do personagem atualizada."); });
  }

  function viewer() {
    const url = portraitUrl(current.id, current.version);
    if (!url) return;
    modal(current.name, `<div class="lib-modal"><div class="lib-pdf-toolbar lib-image-toolbar" role="toolbar" aria-label="Controles da imagem"><span class="lib-zoom">${button("−", "img-zoom-out", "", "subtle", 'aria-label="Diminuir zoom" disabled')}<b data-img-zoom aria-live="polite">–</b>${button("+", "img-zoom-in", "", "subtle", 'aria-label="Aumentar zoom" disabled')}${button("Ajustar", "img-fit", "", "subtle", 'aria-label="Ajustar à tela" disabled')}${button("100%", "img-actual", "", "subtle", 'aria-label="Tamanho real" disabled')}</span></div><div class="lib-stage lib-image-stage" tabindex="0" aria-label="Imagem de ${esc(current.name)}. Role ou use + e − para o zoom, arraste ou use as setas para mover, 0 ajusta à tela."><p class="lib-stage-status" role="status">Carregando imagem…</p><img class="lib-image" alt="${esc(current.name)}" draggable="false" hidden></div><div class="form-actions">${button("Fechar", "modal-close", "", "subtle")}</div></div>`);
    const dialog = $("#modal"), root = $("#modal-body");
    dialog.classList.add("lib-wide");
    const img = root.querySelector(".lib-image"), stage = root.querySelector(".lib-image-stage"), status = root.querySelector(".lib-stage-status");
    const control = (action) => root.querySelector(`[data-action="${action}"]`);
    let zoom = null;
    const onClick = (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (!zoom || !action?.startsWith("img-")) return;
      if (action === "img-zoom-in") zoom.zoomIn();
      if (action === "img-zoom-out") zoom.zoomOut();
      if (action === "img-fit") zoom.fit();
      if (action === "img-actual") zoom.actual();
    };
    root.addEventListener("click", onClick);
    dialog.addEventListener("close", () => { zoom?.destroy(); zoom = null; root.removeEventListener("click", onClick); dialog.classList.remove("lib-wide"); }, { once: true });
    img.onload = () => {
      if (!dialog.open) return;
      status.remove();
      img.hidden = false;
      stage.classList.add("is-zoomable");
      zoom = mountImageZoom(stage, img, {
        onChange({ percent, atMin, atMax, fit }) {
          root.querySelector("[data-img-zoom]").textContent = `${percent}%`;
          control("img-zoom-out").disabled = atMin;
          control("img-zoom-in").disabled = atMax;
          control("img-fit").disabled = fit;
          control("img-actual").disabled = percent === 100;
        },
      });
    };
    img.onerror = () => { status.textContent = "Não foi possível exibir a imagem."; };
    img.src = url;
  }

  const onClick = (event) => {
    const b = event.target.closest("[data-action^='portrait-']");
    if (!b || b.disabled) return;
    const action = b.dataset.action;
    if (action === "portrait-open") viewer();
    if (action === "portrait-pick") host.querySelector("#cs-portrait-file")?.click();
    if (action === "portrait-remove" && confirm(`Remover a imagem de ${current.name}? A ficha não muda.`))
      run(() => api(`/characters/${current.id}/portrait`, "DELETE"), "Removendo imagem…").then((ok) => { if (ok) toast("Imagem removida."); });
  };
  const onFile = (event) => {
    if (event.target.id !== "cs-portrait-file") return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) upload(file);
  };
  host.addEventListener("click", onClick);
  host.addEventListener("change", onFile);
  render();
  return () => { dead = true; host.removeEventListener("click", onClick); host.removeEventListener("change", onFile); };
}
