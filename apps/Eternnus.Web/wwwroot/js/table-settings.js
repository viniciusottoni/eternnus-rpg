// Formulário compartilhado da configuração da mesa (sistema, campanha e sessão). Sem chamadas HTTP aqui.
import { esc, field, fieldHint } from "./ui.js";
import { helpButton } from "./help.js";
import { SETTING_FIELDS, normalizeSettings } from "./fog-policy.js";

const concept = Object.freeze({
  playMode: { help: "campanhas.config.forma-de-jogar" },
  playerRollVisibility: { help: "mesa.rolagem.visibilidade" },
  moveNeedsGrant: { help: "mesa.turnos.liberar-movimento" },
  fogEnabled: { help: "mesa.config.nevoa" },
  manualReveal: { help: "mesa.config.revelacao-manual" },
  rememberExplored: { help: "mesa.config.nevoa" },
  pathMovement: { help: "mesa.config.caminho" },
  alliesAlwaysVisible: { help: "mesa.config.aliados" },
  torchRadius: { help: "mesa.config.luz-visao" },
  brazierRadius: { help: "mesa.config.luz-visao" },
  creatureLight: { help: "mesa.config.luz-visao" },
  playerLightMeters: { help: "mesa.config.luz-visao" },
  playerVisionMeters: { help: "mesa.config.luz-visao" },
});

/** Campos do formulário com rótulos, ajuda e limites. `prefix` evita ids repetidos entre modais. */
export function settingsFields(settings, prefix = "ts") {
  const s = normalizeSettings(settings);
  return `<div class="settings-grid">${SETTING_FIELDS.map((f) => {
    const id = `${prefix}-${f.key}`;
    const help = concept[f.key]?.help;
    if (f.type === "choice") {
      const current = s[f.key] || f.fallback;
      return `<fieldset class="setting-choice"><legend>${esc(f.label)}${helpButton(help, f.label)}</legend>${f.options.map(([v, l]) => `<label class="check"><input type="radio" name="${f.key}" value="${esc(v)}" ${current === v ? "checked" : ""} aria-describedby="${id}-hint"> ${esc(l)}</label>`).join("")}${fieldHint(id, f.help)}</fieldset>`;
    }
    if (f.type === "bool")
      return `<div class="setting-check"><div class="field-label"><label class="check" for="${id}"><input id="${id}" type="checkbox" name="${f.key}" ${s[f.key] ? "checked" : ""} aria-describedby="${id}-hint"><strong>${esc(f.label)}</strong></label>${helpButton(help, f.label)}</div>${fieldHint(id, f.help)}</div>`;
    return field(f.key, f.label, Number(s[f.key] ?? 0), "number", `inputmode="numeric" min="${f.min}" max="${f.max}" step="1" required`, { id, hint: `${f.help} Use de ${f.min} a ${f.max}.`, help });
  }).join("")}</div>`;
}

/** Resumo legível (para “herdado do sistema”). */
export function settingsSummary(settings) {
  const s = normalizeSettings(settings);
  return [
    s.fogEnabled ? "névoa ativa" : "névoa desligada",
    `tochas ${s.torchRadius}`,
    `braseiros ${s.brazierRadius}`,
    s.playerLightMeters ? `luz padrão ${s.playerLightMeters} m` : null,
    s.playerVisionMeters ? `visão padrão ${s.playerVisionMeters} m` : null,
  ].filter(Boolean).join(" · ");
}
