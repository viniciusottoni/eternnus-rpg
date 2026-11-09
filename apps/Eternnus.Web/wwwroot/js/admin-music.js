// Painel admin → Músicas: catálogo do servidor usado por todas as mesas. Admin envia, busca, ouve, renomeia e exclui;
// mestres apenas buscam e reproduzem na mesa. Reutiliza modal, formulários e loading comuns; HTTP em soundtrack-api.js.
import { $, esc, button, modal, formError, submitForm, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { adminDeleteTrack, adminListTracks, adminRenameTrack, adminUploadTrack } from "./soundtrack-api.js";
import { AUDIO_ACCEPT, MUSIC_LIMITS, formatBytes, formatTime, titleFromFile, validateAudioFile } from "./soundtrack-policy.js";

const RIGHTS =
  "Envie somente músicas que a plataforma tem autorização para usar (composição própria, licença adquirida ou domínio público). Não baixe músicas de serviços de terceiros.";

function uploadModal(usage, onDone) {
  modal(
    "Enviar faixa ao catálogo",
    `<form id="am-upload" novalidate><p class="notice-box">${RIGHTS}</p><div class="field"><label for="am-file">Arquivo de áudio</label><input id="am-file" name="file" type="file" accept="${AUDIO_ACCEPT}" required aria-describedby="am-file-hint"><small class="form-help" id="am-file-hint">MP3, M4A (AAC) ou OGG, até 20 MB. Catálogo: até ${MUSIC_LIMITS.maxTracks} faixas e 2 GB. MP3 toca na maior parte dos aparelhos.</small></div><div class="field"><label for="am-title">Título</label><input id="am-title" name="title" maxlength="${MUSIC_LIMITS.maxTitle}" autocomplete="off" aria-describedby="am-title-hint"><small class="form-help" id="am-title-hint">É o nome que os mestres buscam na mesa. Sem título, usamos o nome do arquivo.</small></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Enviar faixa</button></div></form>`,
  );
  const file = $("#am-file");
  file.focus();
  file.addEventListener("change", () => {
    const title = $("#am-title");
    if (!title.value && file.files[0]) title.value = titleFromFile(file.files[0].name);
  });
  $("#am-upload").onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async (data) => {
      const chosen = file.files[0];
      const problem = validateAudioFile(chosen, usage);
      if (problem) throw new Error(problem);
      await adminUploadTrack(chosen, String(data.title || "").trim());
      $("#modal").close();
      toast("Faixa enviada ao catálogo.");
      await onDone();
    });
  };
}

function renameModal(track, onDone) {
  modal(
    "Renomear faixa",
    `<form id="am-rename"><div class="field"><label for="am-rename-title">Título</label><input id="am-rename-title" name="title" maxlength="${MUSIC_LIMITS.maxTitle}" required autocomplete="off" value="${esc(track.title)}"></div>${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="primary">Salvar</button></div></form>`,
  );
  const input = $("#am-rename-title");
  input.focus();
  input.select();
  $("#am-rename").onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async (data) => {
      await adminRenameTrack(track, data.title.trim());
      $("#modal").close();
      toast("Faixa renomeada.");
      await onDone();
    });
  };
}

function deleteModal(track, onDone) {
  modal(
    "Excluir faixa?",
    `<p>“${esc(track.title)}” sai do catálogo de todas as campanhas e o arquivo é apagado do servidor. Quem já ouviu a faixa pode ter partes dela no navegador. A ação fica registrada na auditoria.</p><form id="am-delete">${formError()}<div class="form-actions">${button("Cancelar", "modal-close", "", "subtle")}<button type="submit" class="danger">Excluir</button></div></form>`,
  );
  $("#am-delete").onsubmit = (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, async () => {
      await adminDeleteTrack(track.id);
      $("#modal").close();
      toast("Faixa excluída do catálogo.");
      await onDone();
    });
  };
}

/** Renderiza a aba no painel. Devolve a função de descarte (interrompe a prévia e consultas pendentes). */
export function renderMusicCatalog(view) {
  let search = "",
    page = 1,
    seq = 0,
    result = null,
    timer = 0,
    previewId = "";
  view.innerHTML = `<div class="section-title"><h2>Catálogo de músicas</h2>${helpButton("admin.musicas.catalogo", "Catálogo de músicas")}${button("+ Enviar faixa", "am-upload", "", "primary")}</div>
    <p class="form-help">${RIGHTS} Os mestres buscam estas faixas pelo nome no painel “Trilha” da mesa; jogadores só recebem a faixa que estiver tocando.</p>
    <p class="ml-usage" id="am-usage" aria-live="polite"></p>
    <form class="ml-search" role="search"><div class="field"><label for="am-search">Buscar faixa</label><input id="am-search" type="search" maxlength="100" autocomplete="off" spellcheck="false"></div></form>
    <div id="am-list" class="ml-list" aria-live="polite"></div>
    <div class="ml-preview" hidden><p><span aria-hidden="true">♪</span> Prévia: <strong class="am-preview-title"></strong></p><p class="form-help">Só você ouve a prévia.</p></div>`;
  const list = view.querySelector("#am-list");
  const usageLine = view.querySelector("#am-usage");
  const previewBox = view.querySelector(".ml-preview");
  const preview = document.createElement("audio");
  preview.preload = "none";
  preview.controls = true;
  preview.className = "ml-player";
  preview.setAttribute("aria-label", "Prévia da faixa");
  previewBox.append(preview);

  function rows(items) {
    return `<ul class="ml-tracks">${items
      .map((t) => `<li class="ml-row metal${t.inUse ? " is-current" : ""}"><div class="ml-info"><strong>${esc(t.title)}</strong><small>${esc(t.format)} · ${t.durationMs ? formatTime(t.durationMs) : "duração desconhecida"} · ${formatBytes(t.sizeBytes)}${t.inUse ? ' · <span class="status-chip">Tocando em sessão</span>' : ""}</small></div><div class="ml-actions">${button(previewId === t.id ? "■ Parar prévia" : "▶ Ouvir", "am-preview", t.id, "subtle small", `aria-label="${previewId === t.id ? "Parar prévia" : "Ouvir prévia"}: ${esc(t.title)}"`)}${button("Renomear", "am-rename", t.id, "subtle small", `aria-label="Renomear: ${esc(t.title)}"`)}${t.inUse ? `<button type="button" class="danger small" aria-disabled="true" aria-describedby="am-in-use" data-action="am-delete-blocked">Excluir</button>` : button("Excluir", "am-delete", t.id, "danger small", `aria-label="Excluir: ${esc(t.title)}"`)}</div></li>`)
      .join("")}</ul>${items.some((t) => t.inUse) ? '<p class="form-help" id="am-in-use">Faixas tocando em uma sessão só podem ser excluídas depois que o mestre parar ou trocar a música.</p>' : ""}`;
  }
  function pager() {
    const pages = Math.ceil(result.total / result.pageSize);
    return pages > 1
      ? `<div class="pagination">${button("← Anterior", "am-page", result.page - 1, "subtle", result.page <= 1 ? "disabled" : "")}<span>Página ${result.page} de ${pages}</span>${button("Próxima →", "am-page", result.page + 1, "subtle", result.page >= pages ? "disabled" : "")}</div>`
      : "";
  }
  function paint() {
    if (!result || !view.isConnected) return;
    usageLine.textContent = `${result.usage.tracks} de ${result.limits.maxTracks} faixas · ${formatBytes(result.usage.bytes)} de ${formatBytes(result.limits.maxCatalogBytes)} usados`;
    if (!result.total) {
      list.innerHTML = search
        ? `<p class="feed-empty">Nenhuma faixa encontrada para “${esc(search)}”.</p>`
        : `<div class="empty"><span class="empty-sigil" aria-hidden="true">♪</span><h3>O catálogo está vazio</h3><p>Envie faixas MP3, M4A ou OGG de até 20 MB que a plataforma tem autorização para usar. Assim que chegarem, os mestres poderão buscá-las na mesa.</p>${button("+ Enviar a primeira faixa", "am-upload", "", "primary")}</div>`;
      return;
    }
    list.innerHTML = rows(result.items) + pager();
  }
  async function load() {
    const request = ++seq;
    if (!result) list.innerHTML = '<p class="loading-line" role="status">Consultando o catálogo…</p>';
    try {
      const next = await adminListTracks({ search, page, background: !!result });
      if (request !== seq || !view.isConnected) return;
      result = next;
      paint();
    } catch (failure) {
      if (request !== seq || !view.isConnected) return;
      list.innerHTML = `<p class="form-error" role="alert">${esc(failure.message)}</p>${button("Tentar novamente", "am-retry", "", "subtle small")}`;
    }
  }
  function stopPreview() {
    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    previewId = "";
    previewBox.hidden = true;
  }

  const onClick = async (event) => {
    const b = event.target.closest("[data-action^='am-']");
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    const track = result?.items.find((t) => t.id === b.dataset.id);
    try {
      if (b.dataset.action === "am-upload") uploadModal(result?.usage, load);
      if (b.dataset.action === "am-retry") await load();
      if (b.dataset.action === "am-page") {
        page = Number(b.dataset.id) || 1;
        await load();
      }
      if (b.dataset.action === "am-rename" && track) renameModal(track, load);
      if (b.dataset.action === "am-delete" && track)
        deleteModal(track, async () => {
          if (previewId === track.id) stopPreview();
          await load();
        });
      if (b.dataset.action === "am-preview" && track) {
        if (previewId === track.id) stopPreview();
        else {
          previewId = track.id;
          preview.src = track.audioUrl;
          view.querySelector(".am-preview-title").textContent = track.title;
          previewBox.hidden = false;
          preview.play().catch(() => toast("Toque em reproduzir na prévia para ouvir."));
        }
        paint();
      }
    } catch (failure) {
      toast(failure.message);
    }
  };
  // Os modais vivem fora da aba: o botão "Enviar" do vazio e do topo chegam pelo mesmo despacho.
  view.addEventListener("click", onClick);
  view.querySelector(".ml-search").addEventListener("submit", (event) => event.preventDefault());
  view.querySelector("#am-search").addEventListener("input", (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      search = event.target.value.trim().slice(0, 100);
      page = 1;
      load();
    }, 300);
  });
  preview.addEventListener("ended", () => {
    previewId = "";
    paint();
  });
  load();

  return () => {
    seq++;
    clearTimeout(timer);
    stopPreview();
    view.removeEventListener("click", onClick);
  };
}
