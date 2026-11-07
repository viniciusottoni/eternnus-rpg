// Tabuleiro da mesa: tileset desenhado em canvas a partir da grade oficial do servidor, ou imagem cartográfica.
// Camada estática em cache; luzes, água e marcadores animados respeitam prefers-reduced-motion e abas ocultas.
import { initials } from "./session-policy.js";

const reduceMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const SIDE = { ally: "#7cc35b", enemy: "#d4533f", neutral: "#c9c2a6" };
const LIGHTS = "Tb";

function hash(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function hueOf(text) {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
const at = (rows, x, y) =>
  y >= 0 && y < rows.length && x >= 0 && x < rows[y].length ? rows[y][x] : "#";
const blocks = (c) => "#T".includes(c);

/** Desenha uma célula do tileset na camada estática. */
function drawTile(g, rows, x, y, s) {
  const c = at(rows, x, y);
  const px = x * s,
    py = y * s,
    r = hash(x, y);
  const outdoor = rows.some((row) => row.includes(","));
  const ground = () => {
    if (outdoor) {
      g.fillStyle = `hsl(${92 + r * 18} ${26 + r * 10}% ${17 + r * 6}%)`;
      g.fillRect(px, py, s, s);
      g.strokeStyle = `hsla(${80 + r * 30} 40% 38% / .35)`;
      g.lineWidth = Math.max(1, s / 28);
      for (let i = 0; i < 4; i++) {
        const bx = px + hash(x, y, i + 3) * s,
          by = py + hash(x, y, i + 9) * s;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + (hash(x, y, i) - 0.5) * s * 0.15, by - s * 0.14);
        g.stroke();
      }
    } else {
      g.fillStyle = `hsl(${32 + r * 8} ${14 + r * 6}% ${21 + r * 7}%)`;
      g.fillRect(px, py, s, s);
      g.fillStyle = "#ffffff0d";
      g.fillRect(px + 1, py + 1, s - 2, Math.max(1, s * 0.06));
      g.fillStyle = "#0000003a";
      g.fillRect(px, py + s - Math.max(1, s * 0.07), s, Math.max(1, s * 0.07));
      if (r > 0.82) {
        g.strokeStyle = "#00000055";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(px + s * 0.2, py + s * 0.3);
        g.lineTo(px + s * 0.45, py + s * 0.55);
        g.lineTo(px + s * 0.4, py + s * 0.8);
        g.stroke();
      }
    }
  };
  if (blocks(c)) {
    g.fillStyle = `hsl(28 12% ${9 + r * 4}%)`;
    g.fillRect(px, py, s, s);
    g.strokeStyle = "#ffffff12";
    g.lineWidth = 1;
    const off = y % 2 ? s / 2 : 0;
    g.beginPath();
    g.moveTo(px, py + s / 2);
    g.lineTo(px + s, py + s / 2);
    g.moveTo(px + ((off + s / 2) % s), py);
    g.lineTo(px + ((off + s / 2) % s), py + s / 2);
    g.moveTo(px + (off % s), py + s / 2);
    g.lineTo(px + (off % s), py + s);
    g.stroke();
    if (!blocks(at(rows, x, y + 1))) {
      // Face frontal da parede: sugere profundidade sem perspectiva real.
      const grad = g.createLinearGradient(0, py + s * 0.62, 0, py + s);
      grad.addColorStop(0, "#5a4a36");
      grad.addColorStop(1, "#2a221a");
      g.fillStyle = grad;
      g.fillRect(px, py + s * 0.62, s, s * 0.38);
      g.fillStyle = "#c6a46333";
      g.fillRect(px, py + s * 0.62, s, Math.max(1, s * 0.04));
    }
    if (c === "T") {
      g.fillStyle = "#3b2a18";
      g.fillRect(px + s * 0.44, py + s * 0.5, s * 0.12, s * 0.32);
      g.fillStyle = "#6d5434";
      g.fillRect(px + s * 0.36, py + s * 0.46, s * 0.28, s * 0.08);
    }
    return;
  }
  if (c === "~") {
    g.fillStyle = `hsl(${192 + r * 10} 38% ${17 + r * 5}%)`;
    g.fillRect(px, py, s, s);
    return;
  }
  ground();
  if (c === "+") {
    g.fillStyle = "#4a3320";
    g.fillRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84);
    g.strokeStyle = "#24170d";
    g.lineWidth = Math.max(1, s / 22);
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(px + s * 0.08 + (s * 0.84 * i) / 4, py + s * 0.08);
      g.lineTo(px + s * 0.08 + (s * 0.84 * i) / 4, py + s * 0.92);
      g.stroke();
    }
    g.fillStyle = "#c6a463";
    g.beginPath();
    g.arc(px + s * 0.72, py + s * 0.5, s * 0.05, 0, Math.PI * 2);
    g.fill();
  }
  if (c === "=") {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = `hsl(32 12% ${30 - i * 5}%)`;
      g.fillRect(px + s * 0.06, py + s * (0.08 + i * 0.22), s * 0.88, s * 0.18);
    }
  }
  if (c === "r")
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `hsl(30 8% ${22 + hash(x, y, i) * 18}%)`;
      g.beginPath();
      g.arc(
        px + hash(x, y, i + 1) * s,
        py + hash(x, y, i + 7) * s,
        s * (0.05 + hash(x, y, i + 2) * 0.07),
        0,
        Math.PI * 2,
      );
      g.fill();
    }
  if (c === "S") {
    g.strokeStyle = "#c6a4632e";
    g.lineWidth = Math.max(1, s / 30);
    g.beginPath();
    g.arc(px + s / 2, py + s / 2, s * 0.32, 0, Math.PI * 2);
    g.stroke();
  }
  if (c === "o") {
    g.fillStyle = "#00000066";
    g.beginPath();
    g.ellipse(
      px + s * 0.56,
      py + s * 0.62,
      s * 0.4,
      s * 0.3,
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
    const grad = g.createRadialGradient(
      px + s * 0.42,
      py + s * 0.38,
      s * 0.05,
      px + s / 2,
      py + s / 2,
      s * 0.4,
    );
    grad.addColorStop(0, "#8b7a5e");
    grad.addColorStop(1, "#3d3326");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(px + s / 2, py + s / 2, s * 0.36, 0, Math.PI * 2);
    g.fill();
  }
  if (c === "A") {
    g.fillStyle = "#00000070";
    g.fillRect(px + s * 0.12, py + s * 0.2, s * 0.86, s * 0.78);
    g.fillStyle = "#5b4c39";
    g.fillRect(px + s * 0.08, py + s * 0.12, s * 0.84, s * 0.72);
    g.strokeStyle = "#c6a463";
    g.lineWidth = Math.max(1, s / 18);
    g.beginPath();
    g.moveTo(px + s / 2, py + s * 0.24);
    g.lineTo(px + s * 0.7, py + s * 0.48);
    g.lineTo(px + s / 2, py + s * 0.72);
    g.lineTo(px + s * 0.3, py + s * 0.48);
    g.closePath();
    g.stroke();
  }
  if (c === "b") {
    g.fillStyle = "#00000066";
    g.beginPath();
    g.ellipse(px + s / 2, py + s * 0.62, s * 0.36, s * 0.2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#4b3a28";
    g.beginPath();
    g.ellipse(px + s / 2, py + s * 0.55, s * 0.3, s * 0.18, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (c === "t") {
    g.fillStyle = "#00000059";
    g.beginPath();
    g.ellipse(
      px + s * 0.6,
      py + s * 0.66,
      s * 0.46,
      s * 0.34,
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
    for (let i = 0; i < 3; i++) {
      g.fillStyle = `hsl(${118 + i * 6} 30% ${14 + i * 5 + r * 4}%)`;
      g.beginPath();
      g.arc(
        px + s * (0.42 + i * 0.05),
        py + s * (0.44 - i * 0.04),
        s * (0.44 - i * 0.1),
        0,
        Math.PI * 2,
      );
      g.fill();
    }
  }
}

function buildStatic(rows, s) {
  const w = rows[0].length,
    h = rows.length;
  const layer = document.createElement("canvas");
  layer.width = w * s;
  layer.height = h * s;
  const g = layer.getContext("2d");
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) drawTile(g, rows, x, y, s);
  // Vinheta para concentrar a atenção no centro da cena.
  const v = g.createRadialGradient(
    layer.width / 2,
    layer.height / 2,
    Math.min(layer.width, layer.height) * 0.3,
    layer.width / 2,
    layer.height / 2,
    Math.max(layer.width, layer.height) * 0.75,
  );
  v.addColorStop(0, "#00000000");
  v.addColorStop(1, "#000000aa");
  g.fillStyle = v;
  g.fillRect(0, 0, layer.width, layer.height);
  return layer;
}

/** Miniatura do mapa para escolhas do mestre. */
export function mapThumbnail(el, map) {
  if (!el || !map) return;
  if (map.imageUrl || map.kind !== "tileset" || !map.rows?.length) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.src = map.imageUrl || "/assets/valley.webp";
    el.replaceChildren(img);
    return;
  }
  const canvas = document.createElement("canvas");
  const s = 10;
  const layer = buildStatic(map.rows, s);
  canvas.width = layer.width;
  canvas.height = layer.height;
  const g = canvas.getContext("2d");
  g.drawImage(layer, 0, 0);
  drawLights(g, map.rows, s, 0, false);
  el.replaceChildren(canvas);
}

function drawLights(g, rows, s, t, animate) {
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (!LIGHTS.includes(c)) continue;
      const flicker = animate
        ? 0.86 +
          0.14 * Math.sin(t / 130 + x * 3.1 + y) * Math.sin(t / 77 + y * 1.7)
        : 1;
      const cx = (x + 0.5) * s,
        cy = (y + (c === "T" ? 0.7 : 0.45)) * s;
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, s * 3.2 * flicker);
      glow.addColorStop(0, "rgba(255,170,70,.34)");
      glow.addColorStop(0.4, "rgba(255,120,40,.12)");
      glow.addColorStop(1, "rgba(255,120,40,0)");
      g.fillStyle = glow;
      g.fillRect(cx - s * 3.3, cy - s * 3.3, s * 6.6, s * 6.6);
      // Chama
      const fh = s * (0.26 + (animate ? 0.06 * Math.sin(t / 90 + x) : 0));
      const flame = g.createRadialGradient(
        cx,
        cy - fh * 0.3,
        0,
        cx,
        cy - fh * 0.3,
        fh,
      );
      flame.addColorStop(0, "rgba(255,240,190,.95)");
      flame.addColorStop(0.45, "rgba(255,160,60,.8)");
      flame.addColorStop(1, "rgba(200,60,20,0)");
      g.fillStyle = flame;
      g.beginPath();
      g.ellipse(cx, cy - fh * 0.3, fh * 0.55, fh, 0, 0, Math.PI * 2);
      g.fill();
    }
  g.restore();
}

function drawWater(g, rows, s, t) {
  g.save();
  g.strokeStyle = "rgba(170,220,230,.16)";
  g.lineWidth = Math.max(1, s / 26);
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] !== "~") continue;
      const phase = t / 900 + x * 0.7 + y * 0.4;
      g.beginPath();
      for (let i = 0; i <= 8; i++) {
        const px = x * s + (i / 8) * s,
          py = y * s + s * 0.5 + Math.sin(phase + i * 0.8) * s * 0.08;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawToken(g, token, s, opts, t) {
  const cx = (token.x + 0.5) * s,
    cy = (token.y + 0.5) * s,
    radius = s * 0.4;
  g.save();
  if (opts.offline) g.globalAlpha = 0.42;
  g.fillStyle = "#00000080";
  g.beginPath();
  g.ellipse(
    cx + s * 0.04,
    cy + s * 0.08,
    radius,
    radius * 0.92,
    0,
    0,
    Math.PI * 2,
  );
  g.fill();
  if (opts.active) {
    const pulse = opts.animate ? 0.5 + 0.5 * Math.sin(t / 260) : 0.7;
    g.shadowColor = "#f1d79c";
    g.shadowBlur = s * (0.25 + pulse * 0.35);
    g.strokeStyle = `rgba(241,215,156,${0.55 + pulse * 0.45})`;
    g.lineWidth = Math.max(2, s * 0.08);
    g.beginPath();
    g.arc(cx, cy, radius + s * 0.08, 0, Math.PI * 2);
    g.stroke();
    g.shadowBlur = 0;
  }
  const hue = hueOf(token.label);
  const fill = g.createRadialGradient(
    cx - radius * 0.35,
    cy - radius * 0.4,
    radius * 0.1,
    cx,
    cy,
    radius,
  );
  fill.addColorStop(
    0,
    token.side === "enemy" ? "#6e2a22" : `hsl(${hue} 28% 34%)`,
  );
  fill.addColorStop(
    1,
    token.side === "enemy" ? "#2a0f0c" : `hsl(${hue} 30% 13%)`,
  );
  g.fillStyle = fill;
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = SIDE[token.side] || SIDE.neutral;
  g.lineWidth = Math.max(2, s * 0.07);
  g.stroke();
  if (opts.mine) {
    g.strokeStyle = "#f1d79caa";
    g.lineWidth = Math.max(1, s * 0.025);
    g.beginPath();
    g.arc(cx, cy, radius * 0.78, 0, Math.PI * 2);
    g.stroke();
  }
  if (opts.selected) {
    g.setLineDash([s * 0.12, s * 0.08]);
    g.strokeStyle = "#ffffff";
    g.lineWidth = Math.max(1, s * 0.04);
    g.beginPath();
    g.arc(cx, cy, radius + s * 0.14, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  g.fillStyle = "#f6ead0";
  g.font = `600 ${Math.max(9, s * 0.3)}px Georgia, serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(initials(token.label), cx, cy + s * 0.01);
  if (s >= 26) {
    g.font = `600 ${Math.max(9, s * 0.2)}px "Segoe UI", Arial, sans-serif`;
    const label =
      token.label.length > 14 ? token.label.slice(0, 13) + "…" : token.label;
    const w = g.measureText(label).width + s * 0.24;
    g.fillStyle = "#0b0a08d9";
    roundRect(g, cx - w / 2, cy + radius + s * 0.04, w, s * 0.28, s * 0.08);
    g.fill();
    g.fillStyle = token.side === "enemy" ? "#f0b4a6" : "#efe6cf";
    g.fillText(label, cx, cy + radius + s * 0.18);
  }
  g.restore();
}

export function createBoard(host, handlers = {}) {
  host.innerHTML = `<canvas class="board-canvas" tabindex="0" role="application" aria-roledescription="tabuleiro" aria-label="Mapa tático. Use as setas para escolher uma casa e Enter para confirmar."></canvas><img class="board-image" alt="" hidden referrerpolicy="no-referrer"><p class="sr-only" aria-live="polite" data-board-status></p>`;
  const canvas = host.querySelector("canvas"),
    image = host.querySelector("img"),
    status = host.querySelector("[data-board-status]");
  const g = canvas.getContext("2d");
  let state = null,
    view = { mode: "none", reach: [], selected: null, grid: true },
    layer = null,
    layerKey = "",
    cell = 0,
    ox = 0,
    oy = 0,
    frame = 0,
    last = 0,
    cursor = null,
    dpr = 1;
  const rows = () => state?.map?.rows || [];
  const tileset = () => state?.map?.kind === "tileset" && rows().length > 0;

  const uploaded = () => Number(state?.map?.gridPixels) >= 8;
  image.onload = () => { layout(); draw(); };
  image.onerror = () => { status.textContent = "Não foi possível carregar o mapa. Tente atualizar a mesa."; };

  function layout() {
    const rect = host.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    if (!tileset()) return;
    const r = rows();
    cell = Math.max(
      1,
      Math.floor(
        Math.min(canvas.width / r[0].length, canvas.height / r.length),
      ),
    );
    ox = Math.floor((canvas.width - cell * r[0].length) / 2);
    oy = Math.floor((canvas.height - cell * r.length) / 2);
    const key = state.map.key + ":" + cell;
    if (key !== layerKey) {
      layer = uploaded() ? null : buildStatic(r, cell);
      layerKey = key;
    }
  }
  function draw(t = performance.now()) {
    if (!tileset()) return;
    const animate = !reduceMotion();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#0b0a08";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.translate(ox, oy);
    const r = rows();
    if (uploaded()) {
      if (image.complete && image.naturalWidth) g.drawImage(image, 0, 0, r[0].length * state.map.gridPixels, r.length * state.map.gridPixels, 0, 0, r[0].length * cell, r.length * cell);
    } else {
      g.drawImage(layer, 0, 0);
      drawWater(g, r, cell, animate ? t : 0);
      drawLights(g, r, cell, t, animate);
    }
    if (view.grid) {
      g.strokeStyle = uploaded() ? "rgba(241,215,156,.35)" : "rgba(241,215,156,.07)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= r[0].length; x++) {
        g.moveTo(x * cell + 0.5, 0);
        g.lineTo(x * cell + 0.5, r.length * cell);
      }
      for (let y = 0; y <= r.length; y++) {
        g.moveTo(0, y * cell + 0.5);
        g.lineTo(r[0].length * cell, y * cell + 0.5);
      }
      g.stroke();
    }
    if (view.reach?.length) {
      const pulse = animate ? 0.55 + 0.45 * Math.sin(t / 300) : 0.8;
      for (const c of view.reach) {
        g.fillStyle =
          view.mode === "place"
            ? `rgba(212,83,63,${0.12 * pulse})`
            : `rgba(241,215,156,${0.16 * pulse})`;
        g.fillRect(c.x * cell + 2, c.y * cell + 2, cell - 4, cell - 4);
        g.strokeStyle =
          view.mode === "place"
            ? "rgba(212,83,63,.35)"
            : "rgba(241,215,156,.4)";
        g.strokeRect(c.x * cell + 2.5, c.y * cell + 2.5, cell - 5, cell - 5);
      }
    }
    const online = new Set(
      (state.participants || [])
        .filter((p) => p.online)
        .map((p) => p.characterId),
    );
    for (const token of state.tokens || [])
      drawToken(
        g,
        token,
        cell,
        {
          active:
            token.characterId &&
            token.characterId === state.session.activeCharacterId,
          mine: token.characterId && token.characterId === state.me.characterId,
          selected: token.id === view.selected,
          offline: token.characterId && !online.has(token.characterId),
          animate,
        },
        t,
      );
    if (cursor) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2;
      g.strokeRect(
        cursor.x * cell + 1,
        cursor.y * cell + 1,
        cell - 2,
        cell - 2,
      );
    }
  }
  function loop(t) {
    frame = requestAnimationFrame(loop);
    if (document.hidden || t - last < 33) return; // ~30 fps é suficiente para chamas e brilho.
    last = t;
    draw(t);
  }
  function restart() {
    cancelAnimationFrame(frame);
    if (tileset() && !reduceMotion()) frame = requestAnimationFrame(loop);
    else draw();
  }
  function cellAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) * dpr - ox) / cell),
      y = Math.floor(((clientY - rect.top) * dpr - oy) / cell);
    return x >= 0 && y >= 0 && x < rows()[0].length && y < rows().length
      ? { x, y }
      : null;
  }
  function activate(c) {
    if (!c) return;
    const token = (state.tokens || []).find((t) => t.x === c.x && t.y === c.y);
    if (token) handlers.onToken?.(token, c);
    else handlers.onCell?.(c);
  }
  canvas.addEventListener("click", (e) =>
    activate(cellAt(e.clientX, e.clientY)),
  );
  canvas.addEventListener("keydown", (e) => {
    if (!tileset()) return;
    const moves = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const r = rows();
      const start = cursor ||
        (state.tokens || []).find(
          (t) => t.characterId === state.me.characterId,
        ) || { x: Math.floor(r[0].length / 2), y: Math.floor(r.length / 2) };
      cursor = {
        x: Math.min(r[0].length - 1, Math.max(0, start.x + moves[e.key][0])),
        y: Math.min(r.length - 1, Math.max(0, start.y + moves[e.key][1])),
      };
      const token = (state.tokens || []).find(
        (t) => t.x === cursor.x && t.y === cursor.y,
      );
      status.textContent = `Coluna ${cursor.x + 1}, linha ${cursor.y + 1}${token ? ": " + token.label : ""}`;
      draw();
    } else if ((e.key === "Enter" || e.key === " ") && cursor) {
      e.preventDefault();
      activate(cursor);
    } else if (e.key === "Escape") handlers.onCancel?.();
  });
  canvas.addEventListener("blur", () => {
    cursor = null;
    draw();
  });
  const observer = new ResizeObserver(() => {
    layout();
    draw();
  });
  observer.observe(host);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener?.("change", restart);

  return {
    update(next, nextView = view) {
      const previousKey = state?.map?.key;
      state = next;
      view = { ...view, ...nextView };
      const isTile = tileset();
      canvas.hidden = !isTile && !uploaded();
      image.hidden = isTile || uploaded();
      canvas.setAttribute("aria-label", uploaded() ? `Mapa tático ${state.map.name}. Cada quadrado representa ${state.map.scaleMeters} metros. Use as setas para escolher uma casa e Enter para confirmar.` : "Mapa tático. Use as setas para escolher uma casa e Enter para confirmar.");
      const src = state.map.imageUrl || "";
      if (src && image.getAttribute("src") !== src) image.src = src;
      image.alt = "Mapa: " + state.map.name;
      if (!isTile) cancelAnimationFrame(frame);
      layout();
      if (uploaded()) draw();
      if (previousKey !== state.map.key) {
        host.classList.remove("revealing");
        void host.offsetWidth;
        host.classList.add("revealing");
      }
      restart();
    },
    setView(nextView) {
      view = { ...view, ...nextView };
      if (reduceMotion() || !tileset()) draw();
    },
    focus() {
      canvas.focus();
    },
    destroy() {
      cancelAnimationFrame(frame);
      image.onload = null; image.onerror = null;
      observer.disconnect();
      motion.removeEventListener?.("change", restart);
    },
  };
}
