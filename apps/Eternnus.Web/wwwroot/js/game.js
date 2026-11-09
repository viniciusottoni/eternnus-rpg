// Fichas pessoais e versões das fichas. Campanhas, one-shots e mesa ao vivo ficam em módulos próprios.
import { state } from "./state.js";
import { api } from "./api.js";
import { $, esc, button, toast, modal, empty, formatDate } from "./ui.js";
import { openSheetEditor, hpBar, paintBars } from "./sheet.js";

const titles = {
  characters: [
    "HERÓIS QUE CARREGAM HISTÓRIAS",
    "Personagens",
    "Crie fichas, defina ações e acompanhe a evolução das suas lendas.",
  ],
  history: [
    "CADA ESCOLHA DEIXA UMA MARCA",
    "Histórico das fichas",
    "Consulte as versões anteriores das suas fichas.",
  ],
};
const VIEWS = Object.keys(titles);

async function refresh() {
  state.characters = await api("/characters");
}
function characterCard(c) {
  return `<article class="card character-card metal"><div class="card-top"><span class="crest" aria-hidden="true">♜</span><span class="badge">Nível ${c.level}</span></div><div class="card-body"><span class="eyebrow">${esc(c.archetype || "Uma lenda em formação")}</span><h3>${esc(c.name)}</h3><div class="small muted">Vitalidade <span>${c.hp} / ${c.maxHp}</span></div>${hpBar(c.hp, c.maxHp)}<p class="small muted">${(c.actions || []).length} ${(c.actions || []).length === 1 ? "ação" : "ações"} na ficha</p><div class="card-actions">${button("Abrir ficha →", "character", c.id, "primary")}${button("◷ Versões", "history", c.id, "subtle")}</div></div></article>`;
}

export async function renderGame() {
  const view = VIEWS.includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "characters";
  const [eyebrow, title, subtitle] = titles[view];
  const create = button("+ Criar personagem", "character", "", "primary");
  let html = `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div>${create}</div>`;
  if (view === "characters")
    html += state.characters.length
      ? `<div class="cards">${state.characters.map(characterCard).join("")}</div>`
      : empty(
          "Quem será a sua próxima lenda?",
          "Suas fichas ficam salvas na conta, com histórico de cada alteração.",
          "character",
          "+ Criar personagem",
        );
  if (view === "history")
    html += state.characters.length
      ? `<div class="panel metal">${state.characters.map((c) => `<div class="list-item"><div><strong>${esc(c.name)}</strong><p>Versão ${c.revision} · ${formatDate(c.updatedAt)}</p></div>${button("Consultar versões →", "history", c.id, "subtle")}</div>`).join("")}</div>`
      : empty(
          "Histórias também têm memória.",
          "Crie uma ficha para começar a registrar sua evolução.",
          "character",
          "+ Criar personagem",
        );
  $("#main").innerHTML = html;
  paintBars($("#main"));
}

async function historyModal(id) {
  const rows = await api("/characters/" + id + "/history");
  modal(
    "As marcas da sua jornada",
    rows
      .map((v) => {
        const c = JSON.parse(v.snapshot);
        return `<details class="history-entry"><summary>Versão ${v.revision} · ${formatDate(v.createdAt)}</summary><div class="history-snapshot"><strong>${esc(c.Name)}</strong> · ${esc(c.Archetype)}<br>Nível ${Number(c.Level)} · Vida ${Number(c.Hp)}/${Number(c.MaxHp)}<br>Força ${Number(c.Strength)} · Destreza ${Number(c.Agility)} · Constituição ${Number(c.Constitution ?? 10)} · Intelecto ${Number(c.Intellect)}<br>Armadura ${Number(c.Armor ?? 10)} · Movimento ${Number(c.Movement ?? 9)} m · ${(c.Actions || []).length} ações<hr>${esc(c.Notes || "Sem anotações.")}</div></details>`;
      })
      .join(""),
  );
}

document.addEventListener("click", async (e) => {
  if (!VIEWS.includes(location.hash.slice(1))) return;
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const { action, id } = b.dataset;
  try {
    if (action === "character")
      openSheetEditor(
        state.characters.find((c) => c.id === id),
        async () => {
          await refresh();
          await renderGame();
        },
      );
    if (action === "history") await historyModal(id);
  } catch (error) {
    toast(error.message);
  }
});
