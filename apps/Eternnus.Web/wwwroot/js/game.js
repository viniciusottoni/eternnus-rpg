// Fichas pessoais, mesa rápida de dados e versões das fichas. Campanhas e mesa ao vivo ficam em módulos próprios.
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
  dice: [
    "DEIXE O DESTINO DECIDIR",
    "Mesa rápida",
    "Fórmulas, modificadores e resultados registrados no servidor.",
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
function dicePanel() {
  return `<div class="panel dice-panel metal"><div class="section-title"><h2>O chamado dos dados</h2><span class="badge">Pessoal</span></div><div class="dice-symbol" aria-hidden="true">20</div><div class="dice-result" id="dice-result" aria-live="polite">✧</div><p class="small muted" id="dice-detail">Uma rolagem pode mudar tudo.</p><div class="dice-choices">${[4, 6, 8, 10, 12, 20].map((n) => button("d" + n, "quick-roll", n, "subtle")).join("")}</div><form class="dice-form" id="dice-form"><label class="sr-only" for="dice-formula">Fórmula dos dados</label><input id="dice-formula" name="formula" value="1d20+0" maxlength="40" required><button class="primary">Rolar dados</button></form><p class="form-help">Use 1d20+3, 2d6 ou 3d8-2. Até 100 dados.</p></div>`;
}

export async function renderGame() {
  const view = VIEWS.includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "characters";
  const [eyebrow, title, subtitle] = titles[view];
  const create =
    view === "dice"
      ? ""
      : button("+ Criar personagem", "character", "", "primary");
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
  if (view === "dice")
    html += `<div class="campaign-layout">${dicePanel()}<section class="panel metal"><div class="section-title"><h2>Últimas rolagens</h2></div><div id="feed" class="feed"></div></section></div>`;
  $("#main").innerHTML = html;
  paintBars($("#main"));
  if (view === "dice") await loadFeed();
}

async function loadFeed() {
  const feed = $("#feed");
  if (!feed) return;
  const events = await api("/events");
  if ($("#feed") !== feed) return;
  feed.innerHTML = events.length
    ? events
        .map((e) => {
          let r = null;
          try {
            r = JSON.parse(e.content);
          } catch {}
          return `<div class="event"><small>${formatDate(e.createdAt)}</small>${r ? `<div class="roll">${esc(r.formula)} → <strong>${esc(r.total)}</strong></div><small>Dados: [${(r.values || []).map(Number).join(", ")}] · Modificador: ${Number(r.modifier)}</small>` : `<p>${esc(e.content)}</p>`}</div>`;
        })
        .join("")
    : '<p class="muted small">Suas rolagens pessoais aparecem aqui.</p>';
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

async function roll(formula) {
  const r = await api("/rolls", "POST", { formula, campaignId: null });
  $("#dice-result").textContent = r.total;
  $("#dice-detail").textContent =
    `${r.formula}: [${r.values.join(", ")}] ${r.modifier >= 0 ? "+" : ""}${r.modifier}`;
  $("#dice-result").classList.remove("rolled");
  void $("#dice-result").offsetWidth;
  $("#dice-result").classList.add("rolled");
  await loadFeed();
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
    if (action === "quick-roll") await roll("1d" + id);
  } catch (error) {
    toast(error.message);
  }
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "dice-form") return;
  e.preventDefault();
  const submit = e.target.querySelector("button");
  submit.disabled = true;
  try {
    await roll(new FormData(e.target).get("formula"));
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
});
