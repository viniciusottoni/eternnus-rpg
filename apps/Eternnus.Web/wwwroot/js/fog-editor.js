// Aba "Configuração da mesa" e atalho para a preparação compartilhada de um mapa (aba Mapas e cenários),
// que usa o editor único de cenas. Carregado sob demanda.
import { api } from "./api.js";
import { $, esc, button, formError, submitForm, toast } from "./ui.js";
import { settingsFromForm } from "./fog-policy.js";
import { settingsFields, settingsSummary } from "./table-settings.js";

/** Aba da campanha: configuração herdada do sistema ou ajustada pelo mestre; vale para as próximas sessões. */
export async function renderTableSettingsTab(d, target) {
  target.innerHTML = '<p role="status">Consultando a configuração da mesa…</p>';
  const data = await api(`/campaigns/${d.id}/table-settings`);
  if (!target.isConnected) return;
  target.innerHTML = `<div class="section-title"><h2>Configuração da mesa</h2></div><p class="muted small">${data.inherited ? `Usando o padrão do sistema ${esc(d.system)}: ${esc(settingsSummary(data.system))}.` : "Ajustada para esta campanha. Toda sessão nova começa com estes valores."} Durante a sessão, você pode mudar só aquela sessão ou a campanha toda.</p><form id="cts-form" class="metal settings-card">${settingsFields(data.settings, "cts")}${formError()}<div class="form-actions">${data.inherited ? "" : button("Voltar ao padrão do sistema", "cts-reset", "", "subtle")}<button type="submit" class="primary">Salvar configuração</button></div></form>`;
  $("#cts-form").onsubmit = (e) => {
    e.preventDefault();
    submitForm(e.currentTarget, async (values) => {
      await api(`/campaigns/${d.id}/table-settings`, "PUT", { settings: settingsFromForm(values) });
      toast("Configuração salva. Vale para esta e as próximas sessões.");
      await renderTableSettingsTab(d, target);
    });
  };
  target.querySelector("[data-action=cts-reset]")?.addEventListener("click", async () => {
    try {
      await api(`/campaigns/${d.id}/table-settings`, "PUT", { settings: null });
      toast("A campanha voltou ao padrão do sistema.");
      await renderTableSettingsTab(d, target);
    } catch (error) { toast(error.message); }
  });
}

/**
 * Preparação compartilhada do mapa (aba "Mapas e cenários"): abre o mesmo editor de cenas, sem cena,
 * só com a camada do mapa. Não existe um segundo editor.
 */
export async function openLayerEditor(d, key) {
  const { openSceneEditor } = await import("./scene-editor.js");
  return openSceneEditor({ campaign: d, mapKey: key, kind: "layer" });
}
