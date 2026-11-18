/**
 * Busca de ações (Ctrl+K ou "/"), regras puras — sem DOM, sem rede (item N4 de docs/AUDITORIA_SIMPLICIDADE.md).
 *
 * Comando: { id, label, group, keywords?: string[], masterOnly?: boolean, basic?: boolean, disabled?: string | null }
 *   - masterOnly: só aparece quando context.role === "master".
 *   - basic === false: ferramenta da interface Completa. Na Básica continua listada, mas sai com needsComplete: true;
 *     quem executa troca para a Completa antes de rodar a ação.
 *   - disabled: motivo exibido ao lado da ação; a ação não pode ser executada.
 *
 * rankCommands(commands, query, { role, mode }) -> cópias dos comandos visíveis, cada uma com needsComplete: boolean.
 *   Busca sem diferenciar maiúsculas nem acentos (mesma dobra de js/data-table.js) em label + keywords + group.
 *   Cada termo da busca precisa casar; a força do comando é a do termo mais fraco:
 *   início de palavra (3) > trecho contínuo (2) > letras em ordem (1). Empate: casar no rótulo vence; depois, ordem original.
 *   Busca vazia devolve todos na ordem original. No máximo COMMAND_LIMIT itens.
 *
 * shouldOpenPalette(event) -> boolean
 *   Ctrl+K / Cmd+K em qualquer lugar (inclusive em campos). "/" só fora de campos de texto
 *   (input, textarea, select, contenteditable) e sem Ctrl, Cmd ou Alt. Shift é aceito porque alguns teclados exigem Shift para "/".
 */
export const COMMAND_LIMIT = 50;

export const foldText = (value) =>
  String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

const words = (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function isSubsequence(term, text) {
  let i = 0;
  for (const char of text) if (char === term[i] && ++i === term.length) return true;
  return term.length === 0;
}

/**
 * Força de um termo em textos já dobrados (um texto ou lista de campos): 3 início de palavra, 2 trecho, 1 letras em ordem,
 * 0 não casa. Letras em ordem valem só dentro de um mesmo campo, para "npc" não casar juntando rótulo, palavra-chave e grupo.
 */
export function termTier(term, fields) {
  const list = [].concat(fields);
  if (!term) return 3;
  if (list.some((text) => words(text).some((word) => word.startsWith(term)))) return 3;
  if (list.some((text) => text.includes(term))) return 2;
  return list.some((text) => isSubsequence(term, text.replace(/\s+/g, ""))) ? 1 : 0;
}

const queryTier = (terms, fields) => terms.reduce((tier, term) => Math.min(tier, termTier(term, fields)), 3);

export function rankCommands(commands, query = "", { role = "", mode = "complete" } = {}) {
  const basicMode = mode === "basic";
  const visible = (Array.isArray(commands) ? commands : [])
    .filter((command) => command && command.id && (!command.masterOnly || role === "master"))
    .map((command) => ({ ...command, needsComplete: basicMode && command.basic === false }));
  const terms = foldText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return visible.slice(0, COMMAND_LIMIT);
  return visible
    .map((command, index) => {
      const label = foldText(command.label);
      const fields = [label, ...(command.keywords || []).map(foldText), foldText(command.group)];
      return { command, index, tier: queryTier(terms, fields), labelTier: queryTier(terms, label) };
    })
    .filter((entry) => entry.tier > 0)
    .sort((a, b) => b.tier - a.tier || b.labelTier - a.labelTier || a.index - b.index)
    .slice(0, COMMAND_LIMIT)
    .map((entry) => entry.command);
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return EDITABLE_TAGS.has(String(target.tagName || "").toUpperCase());
}

export function shouldOpenPalette(event) {
  if (!event || event.isComposing) return false;
  const key = String(event.key || "");
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === "k") return true;
  if (key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return false;
  return !isEditableTarget(event.target);
}
