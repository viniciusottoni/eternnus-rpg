// Tabuleiro da mesa: tileset desenhado em canvas a partir da grade oficial do servidor, ou imagem cartográfica.
// Camada estática em cache; luzes, água e marcadores animados respeitam prefers-reduced-motion e abas ocultas.
// Névoa: o servidor envia as máscaras (visível/explorado); aqui só se desenha. O mestre vê um véu translúcido e as marcas.
import { drawTile, dominantGround, affectedCells } from "./tile-art.js";
import { initials } from "./session-policy.js";
import { decodeBits, MARK_KINDS, WALL_UNIT, lightReach, wallKind } from "./fog-policy.js";
import { helpButton } from "./help.js";
import { mountMapGestures } from "./map-gestures.js";
import { safeImageUrl } from "./play-policy.js";
import { finePoint, isFreeMap, tokenCenter } from "./free-move-policy.js";
import { drawOrder, imageBox, isImageLook, sizeFromHandle, tokenHalf, tokenScale, tokenUnder, hasSpan, tokenSpan, covers, SPAN_HANDLES, boxFromHandle, spanFromBox, spanLabel, LOOK_IMAGE } from "./token-look.js";

const reduceMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const SIDE = { ally: "#7cc35b", enemy: "#d4533f", neutral: "#c9c2a6" };
const LIGHTS = "Tb";

function hueOf(text) {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function tileFlags(rows) {
  const outdoor = rows.some(row => row.includes(","));
  const timber = !outdoor && rows.some(row => row.includes("d")) && !rows.some(row => row.includes("~"));
  return { outdoor, timber };
}
/** Tudo o que muda o desenho de todas as casas de uma vez (piso externo, madeira, chão dominante). */
function tileGlobals(rows) {
  const { outdoor, timber } = tileFlags(rows);
  return `${outdoor ? 1 : 0}${timber ? 1 : 0}${dominantGround(rows)}`;
}
// Vinheta para concentrar a atenção no centro da cena. `clip` = só uma casa (repintura), com o mesmo gradiente.
function vignette(g, width, height, clip = null) {
  const v = g.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.75);
  v.addColorStop(0, "#00000000");
  v.addColorStop(1, "#07111766");
  g.fillStyle = v;
  if (clip) g.fillRect(clip.x, clip.y, clip.size, clip.size);
  else g.fillRect(0, 0, width, height);
}
function buildStatic(rows, s, ground = null) {
  const w = rows[0].length,
    h = rows.length;
  const layer = document.createElement("canvas");
  layer.width = w * s;
  layer.height = h * s;
  const g = layer.getContext("2d");
  const { outdoor, timber } = tileFlags(rows);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) drawTile(g, rows, x, y, s, outdoor, timber, ground);
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
  const s = 24;
  const layer = buildStatic(map.rows, s, map.terrain);
  canvas.width = layer.width;
  canvas.height = layer.height;
  const g = canvas.getContext("2d");
  g.drawImage(layer, 0, 0);
  vignette(g, canvas.width, canvas.height);
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
        ? 0.94 +
          0.06 * Math.sin(t / 710 + x * 3.1 + y) * Math.sin(t / 470 + y * 1.7)
        : 1;
      const cx = (x + 0.5) * s,
        cy = (y + (c === "T" ? 0.5 : 0.43)) * s;
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, s * 3.2 * flicker);
      glow.addColorStop(0, "rgba(255,170,70,.34)");
      glow.addColorStop(0.4, "rgba(255,120,40,.12)");
      glow.addColorStop(1, "rgba(255,120,40,0)");
      g.fillStyle = glow;
      g.fillRect(cx - s * 3.3, cy - s * 3.3, s * 6.6, s * 6.6);
      // Chama
      const fh = s * (0.26 + (animate ? 0.025 * Math.sin(t / 480 + x) : 0));
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
      g.moveTo(cx - fh * .48, cy);
      g.bezierCurveTo(cx - fh * .72, cy - fh * .5, cx - fh * .1, cy - fh * .65, cx, cy - fh * 1.5);
      g.bezierCurveTo(cx + fh * .55, cy - fh * .9, cx + fh * .16, cy - fh * .5, cx + fh * .4, cy - fh * .7);
      g.bezierCurveTo(cx + fh * .8, cy - fh * .1, cx + fh * .25, cy + fh * .25, cx - fh * .48, cy);
      g.closePath();
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

const rgb = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(hex || ""); const n = m ? parseInt(m[1], 16) : 0xffbe64; return [n >> 16, (n >> 8) & 255, n & 255]; };
/**
 * Brilho suave das fontes de luz que não vêm da legenda do tileset (focos do mestre e luz dos marcadores).
 * `light` opcional: cor, intensidade, penumbra (queda gradual entre a luz plena e o alcance) e animação sutil.
 * Animação só com `animate` (prefers-reduced-motion desliga; a aba oculta pausa o laço).
 */
function drawGlow(g, x, y, radius, s, t, animate, light = null) {
  if (!radius) return;
  const kind = light?.animation;
  let wave = 1;
  if (animate) {
    if (kind === "pulse") wave = 0.9 + 0.1 * Math.sin(t / 700 + x);
    else if (kind === "flicker") wave = 0.92 + 0.05 * Math.sin(t / 90 + x * 3.1) + 0.03 * Math.sin(t / 37 + y);
    else wave = 0.97 + 0.03 * Math.sin(t / 530 + x * 2.3 + y);
  }
  const cx = (x + 0.5) * s, cy = (y + 0.5) * s, r = Math.max(s, radius * s * wave);
  const [cr, cg, cb] = rgb(light?.color);
  const k = Math.min(1, Math.max(0.1, (light?.intensity ?? 100) / 100));
  // Luz plena até `light.radius`; penumbra até o alcance (`dim`).
  const bright = light?.dim > light?.radius ? Math.max(0.15, Math.min(0.9, light.radius / light.dim)) : 0.6;
  const edge = `${cr},${Math.round(cg * 0.8)},${Math.round(cb * 0.6)}`;
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  glow.addColorStop(0, `rgba(${cr},${cg},${cb},${(0.22 * k).toFixed(3)})`);
  glow.addColorStop(bright, `rgba(${edge},${(0.1 * k).toFixed(3)})`);
  glow.addColorStop(1, `rgba(${edge},0)`);
  g.save();
  g.globalCompositeOperation = "lighter";
  g.fillStyle = glow;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.restore();
}

/** Grade pequena (1 px por casa) ampliada: preto nas casas desconhecidas e penumbra nas exploradas fora da vista. */
function fogMask(width, height, fill) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const a = fill(i);
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const CELL_STYLE = {
  "#": ["rgba(212,83,63,.22)", "rgba(212,83,63,.9)"],
  m: ["rgba(230,160,60,.28)", "rgba(230,160,60,.85)"],
  l: ["rgba(110,150,230,.28)", "rgba(110,150,230,.85)"],
  d: ["rgba(160,110,60,.55)", "rgba(241,215,156,.95)"],
  o: ["rgba(160,110,60,.18)", "rgba(241,215,156,.75)"],
};

// Máscaras por objeto de névoa: só mudam com um estado novo, nunca a cada quadro da animação.
const fogMasks = new WeakMap();
function masksOf(fog, w, h, master) {
  const key = `${w}x${h}:${master ? 1 : 0}`;
  const cached = fogMasks.get(fog);
  if (cached?.key === key) return cached;
  const n = w * h;
  let entry;
  if (master) {
    // Véu do mestre: escurece o que os jogadores não veem pela luz/revelação compartilhada.
    const shared = decodeBits(fog.shared, n);
    entry = { key, veil: fogMask(w, h, (i) => (shared[i] ? 0 : 120)) };
  } else {
    const visible = decodeBits(fog.visible, n);
    const explored = decodeBits(fog.explored, n);
    entry = { key, dim: fogMask(w, h, (i) => (visible[i] ? 0 : explored[i] ? 150 : 0)), dark: fogMask(w, h, (i) => (explored[i] ? 0 : 255)) };
  }
  fogMasks.set(fog, entry);
  return entry;
}

function drawFog(g, state, view, s, t, animate) {
  const fog = state.fog;
  const r = state.map.rows;
  if (!fog || !r?.length) return;
  const w = r[0].length, h = r.length;
  const master = state.me?.isMaster && !view.viewAs;
  if (fog.active) {
    const m = masksOf(fog, w, h, master);
    g.save();
    if (master) {
      g.imageSmoothingEnabled = false;
      g.drawImage(m.veil, 0, 0, w * s, h * s);
    } else {
      g.imageSmoothingEnabled = true;
      g.drawImage(m.dim, 0, 0, w * s, h * s);
      g.imageSmoothingEnabled = false;
      g.drawImage(m.dark, 0, 0, w * s, h * s);
    }
    g.restore();
  }
  for (const l of fog.lights || []) {
    drawGlow(g, l.x, l.y, lightReach(l), s, t, animate, l);
    if (master && view.fogTools) {
      g.fillStyle = "#ffd27a";
      g.font = `600 ${Math.max(10, s * 0.5)}px Georgia, serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("✹", (l.x + 0.5) * s, (l.y + 0.5) * s);
    }
  }
  // Paredes, portas e obstáculos: o mestre vê ao preparar; jogadores veem só portas conhecidas.
  if (master ? view.fogTools : true)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = fog.cells?.[y]?.[x];
        const style = CELL_STYLE[c];
        if (!style || (!master && c !== "d" && c !== "o")) continue;
        g.fillStyle = style[0];
        g.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
        g.strokeStyle = style[1];
        g.lineWidth = Math.max(1, s * 0.05);
        if (c === "d" || c === "o") {
          g.strokeRect(x * s + s * 0.2, y * s + s * 0.15, s * 0.6, s * 0.7);
          if (c === "o") { g.beginPath(); g.moveTo(x * s + s * 0.2, y * s + s * 0.15); g.lineTo(x * s + s * 0.55, y * s + s * 0.3); g.lineTo(x * s + s * 0.55, y * s + s * 0.95); g.stroke(); }
        } else g.strokeRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
      }
  drawWalls(g, fog.walls, s, master, master && view.fogTools);
  for (const m of fog.marks || []) {
    const icon = MARK_KINDS.find((k) => k[0] === m.kind)?.[2] || "✦";
    const cx = (m.x + 0.5) * s, cy = (m.y + 0.5) * s;
    const hidden = master && !m.revealedAll && !(m.revealedTo || []).length;
    g.save();
    g.globalAlpha = hidden ? 0.6 : 1;
    g.fillStyle = "#0b0a08cc";
    g.beginPath();
    g.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = m.kind === "trap" ? "#d4533f" : "#f1d79c";
    g.lineWidth = Math.max(1, s * 0.05);
    if (hidden) g.setLineDash([s * 0.08, s * 0.06]);
    g.stroke();
    g.fillStyle = "#f6ead0";
    g.font = `600 ${Math.max(9, s * 0.34)}px Georgia, serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(icon, cx, cy + s * 0.02);
    g.restore();
  }
}

/** Símbolo de porta no meio do segmento: retângulo cheio (fechada) ou vazado com a folha girada (aberta). Não depende de cor. */
function drawDoorGlyph(g, w, s, open) {
  const k = s / WALL_UNIT, mx = ((w.x1 + w.x2) / 2) * k, my = ((w.y1 + w.y2) / 2) * k;
  const angle = Math.atan2(w.y2 - w.y1, w.x2 - w.x1), half = Math.max(4, s * 0.22);
  g.save();
  g.translate(mx, my);
  g.rotate(angle);
  g.fillStyle = open ? "#0b0a08cc" : "#a06e3ce6";
  g.strokeStyle = "#f1d79c";
  g.lineWidth = Math.max(1, s * 0.05);
  g.fillRect(-half, -half * 0.35, half * 2, half * 0.7);
  g.strokeRect(-half, -half * 0.35, half * 2, half * 0.7);
  if (open) { g.beginPath(); g.moveTo(-half, 0); g.lineTo(-half + half * 0.9, -half * 1.2); g.stroke(); }
  g.restore();
}

const WALL_COLORS = { wall: "#e8d3a2", door: "#c08a52", window: "#8ec5e8", sight: "#b48ee8", move: "#e6a03c" };

/**
 * Paredes vetoriais. Mestre preparando: todas, com traço por tipo (sólido, tracejado, pontilhado) e porta com símbolo;
 * ocultas ficam translúcidas. Mestre conduzindo sem ferramentas e jogadores: só portas que não são secretas.
 */
function drawWalls(g, walls, s, master, tools) {
  if (!walls?.length) return;
  const k = s / WALL_UNIT;
  g.save();
  g.lineCap = "round";
  for (const w of walls) {
    const isDoor = w.kind ? w.kind === "door" : w.door != null;
    const open = w.kind ? !!w.open : w.door === "open";
    if (!tools) {
      if (isDoor && !(master && w.hidden)) drawDoorGlyph(g, w, s, open);
      continue;
    }
    const kind = wallKind(w.kind);
    g.globalAlpha = w.hidden ? 0.5 : 1;
    g.setLineDash(kind.dash.map((d) => d * Math.max(1, s * 0.08)));
    g.strokeStyle = "#0b0a08cc";
    g.lineWidth = Math.max(3, s * 0.16);
    g.beginPath(); g.moveTo(w.x1 * k, w.y1 * k); g.lineTo(w.x2 * k, w.y2 * k); g.stroke();
    g.strokeStyle = WALL_COLORS[w.kind] || WALL_COLORS.wall;
    g.lineWidth = Math.max(1.5, s * 0.08);
    g.stroke();
    g.setLineDash([]);
    if (isDoor) drawDoorGlyph(g, w, s, open);
  }
  g.restore();
}

/** Sobreposição do editor de paredes: prévia do traço, selecionadas, vértices e o ponto magnético sob o cursor. */
function drawVectorOverlay(g, vector, walls, s) {
  if (!vector) return;
  const k = s / WALL_UNIT;
  const selected = new Set(vector.selected || []);
  g.save();
  g.lineCap = "round";
  for (const w of walls || []) {
    if (!selected.has(w.id)) continue;
    g.strokeStyle = "#ffffff";
    g.lineWidth = Math.max(2, s * 0.06);
    g.setLineDash([Math.max(3, s * 0.12), Math.max(3, s * 0.1)]);
    g.beginPath(); g.moveTo(w.x1 * k, w.y1 * k); g.lineTo(w.x2 * k, w.y2 * k); g.stroke();
  }
  g.setLineDash([]);
  if (vector.vertices) {
    const seen = new Set();
    g.fillStyle = "#0b0a08";
    g.strokeStyle = "#f1d79c";
    g.lineWidth = 1.5;
    const r = Math.max(3, Math.min(7, s * 0.09));
    for (const w of walls || []) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const key = x + ":" + y;
      if (seen.has(key)) continue;
      seen.add(key);
      g.beginPath(); g.rect(x * k - r, y * k - r, r * 2, r * 2); g.fill(); g.stroke();
    }
  }
  if (vector.preview?.length) {
    g.strokeStyle = "#f1d79c";
    g.lineWidth = Math.max(2, s * 0.07);
    g.setLineDash([Math.max(4, s * 0.15), Math.max(3, s * 0.1)]);
    g.beginPath();
    for (const p of vector.preview) { g.moveTo(p.x1 * k, p.y1 * k); g.lineTo(p.x2 * k, p.y2 * k); }
    g.stroke();
    g.setLineDash([]);
  }
  if (vector.box) {
    const b = vector.box;
    g.strokeStyle = "#f1d79c";
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.strokeRect(Math.min(b.x1, b.x2) * k, Math.min(b.y1, b.y2) * k, Math.abs(b.x2 - b.x1) * k, Math.abs(b.y2 - b.y1) * k);
    g.setLineDash([]);
  }
  if (vector.point) {
    const r = Math.max(4, Math.min(9, s * 0.12));
    g.strokeStyle = vector.point.snapped ? "#7cc35b" : "#f1d79c";
    g.lineWidth = 2;
    g.beginPath(); g.arc(vector.point.x * k, vector.point.y * k, r, 0, Math.PI * 2); g.stroke();
    if (vector.point.snapped) { g.beginPath(); g.moveTo(vector.point.x * k - r, vector.point.y * k); g.lineTo(vector.point.x * k + r, vector.point.y * k); g.stroke(); }
  }
  g.restore();
}

/**
 * Diagnóstico (só no editor do mestre): casas que bloqueiam movimento hachuradas, áreas sem luz em azul e problemas de
 * geometria com triângulo "!" (forma + lista no painel, não só cor).
 */
function drawDiagnostic(g, diag, w, h, s) {
  if (!diag) return;
  g.save();
  if (diag.dark) {
    const dark = decodeBits(diag.dark, w * h);
    g.fillStyle = "rgba(60,90,200,.22)";
    for (let i = 0; i < w * h; i++) if (dark[i]) g.fillRect((i % w) * s, Math.floor(i / w) * s, s, s);
  }
  if (diag.blocked) {
    const blocked = decodeBits(diag.blocked, w * h);
    g.strokeStyle = "rgba(230,160,60,.75)";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < w * h; i++) {
      if (!blocked[i]) continue;
      const x = (i % w) * s, y = Math.floor(i / w) * s;
      g.moveTo(x, y + s); g.lineTo(x + s, y);
      g.moveTo(x, y + s / 2); g.lineTo(x + s / 2, y);
      g.moveTo(x + s / 2, y + s); g.lineTo(x + s, y + s / 2);
    }
    g.stroke();
  }
  const k = s / WALL_UNIT;
  for (const issue of diag.issues || []) {
    const cx = issue.x * k, cy = issue.y * k, r = Math.max(7, s * 0.22);
    g.fillStyle = "#d4533f";
    g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy + r * 0.8); g.lineTo(cx - r, cy + r * 0.8); g.closePath(); g.fill();
    g.fillStyle = "#fff";
    g.font = `700 ${Math.max(9, r)}px Georgia, serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("!", cx, cy + r * 0.2);
  }
  g.restore();
}

// Retratos dos marcadores (NPC/criatura com imagem): uma carga por endereço, desenhada recortada no círculo do marcador.
// Endereços passam por safeImageUrl; falha de carga mantém as iniciais.
const portraits = new Map();
function portraitFor(url, onReady) {
  const src = safeImageUrl(url);
  if (!src) return null;
  let entry = portraits.get(src);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, failed: false, waiting: new Set() };
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = () => { entry.ready = true; for (const notify of entry.waiting) notify(); entry.waiting.clear(); };
    img.onerror = () => { entry.failed = true; entry.waiting.clear(); };
    img.src = src;
    portraits.set(src, entry);
    if (portraits.size > 300) portraits.delete(portraits.keys().next().value);
  }
  if (entry.ready) return entry.img;
  if (!entry.failed && onReady) entry.waiting.add(onReady);
  return null;
}

function drawPortrait(g, img, cx, cy, radius) {
  const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
  if (!width || !height) return false;
  const scale = Math.max((radius * 2) / width, (radius * 2) / height);
  const w = width * scale, h = height * scale;
  g.save();
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.clip();
  g.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  g.restore();
  return true;
}

/** Nome sob o marcador, a partir de 26 px por casa. */
function drawLabel(g, token, s, cx, top) {
  if (s < 26) return;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `600 ${Math.max(9, s * 0.2)}px "Segoe UI", Arial, sans-serif`;
  const label = token.label.length > 14 ? token.label.slice(0, 13) + "…" : token.label;
  const w = g.measureText(label).width + s * 0.24;
  g.fillStyle = "#0b0a08d9";
  roundRect(g, cx - w / 2, top, w, s * 0.28, s * 0.08);
  g.fill();
  g.fillStyle = token.side === "enemy" ? "#f0b4a6" : "#efe6cf";
  g.fillText(label, cx, top + s * 0.14);
}

/**
 * Imagem livre (PNG com transparência): sem moldura redonda; a sombra segue o recorte. O lado aparece num anel aos pés,
 * e oculto/percebido/selecionado usam contorno tracejado retangular. Falso se a imagem ainda não pode ser desenhada.
 */
/**
 * Área retangular da imagem livre (ADR-092) em pixels, a partir da posição visual (x, y = centro − 0,5 casa, como nos demais
 * marcadores). Tático: canto na casa (x, y) e casas inteiras. Livre: centrada no ponto, largura/altura em % da casa.
 */
function visualBox(token, s, free) {
  if (free) {
    const w = (token.width / 100) * s, h = (token.height / 100) * s;
    return { x: (token.x + 0.5) * s - w / 2, y: (token.y + 0.5) * s - h / 2, w, h };
  }
  const { w, h } = tokenSpan(token);
  return { x: token.x * s, y: token.y * s, w: w * s, h: h * s };
}

function drawFreeImage(g, token, s, opts, t, cx, cy) {
  const img = opts.portrait;
  const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
  if (!width || !height) return false;
  // Área própria: a imagem é esticada para preencher o retângulo escolhido pelo mestre.
  const box = hasSpan(token) ? visualBox(token, s, opts.free) : imageBox(cx, cy, s * tokenScale(token), width, height);
  g.save();
  if (opts.offline) g.globalAlpha = 0.42;
  if (token.hidden || token.perceived) g.globalAlpha = 0.55;
  g.fillStyle = (SIDE[token.side] || SIDE.neutral) + "99";
  g.beginPath();
  g.ellipse(cx, box.y + box.h - s * 0.04, Math.max(s * 0.18, box.w * 0.34), Math.max(s * 0.05, box.w * 0.08), 0, 0, Math.PI * 2);
  g.fill();
  if (opts.active) {
    const pulse = opts.animate ? 0.5 + 0.5 * Math.sin(t / 260) : 0.7;
    g.shadowColor = "#f1d79c";
    g.shadowBlur = s * (0.25 + pulse * 0.35);
  } else {
    g.shadowColor = "#000000a6";
    g.shadowBlur = s * 0.12;
    g.shadowOffsetY = s * 0.05;
  }
  g.drawImage(img, box.x, box.y, box.w, box.h);
  g.shadowColor = "transparent";
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  const outline = (color, width, dash) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.setLineDash(dash);
    g.strokeRect(box.x - s * 0.06, box.y - s * 0.06, box.w + s * 0.12, box.h + s * 0.12);
    g.setLineDash([]);
  };
  if (token.hidden || token.perceived) outline(SIDE[token.side] || SIDE.neutral, Math.max(2, s * 0.05), [s * 0.1, s * 0.07]);
  if (opts.mine) outline("#f1d79caa", Math.max(1, s * 0.025), []);
  if (opts.selected) outline("#ffffff", Math.max(1, s * 0.04), [s * 0.12, s * 0.08]);
  drawLabel(g, token, s, cx, box.y + box.h + s * 0.04);
  g.restore();
  return true;
}

function drawToken(g, token, s, opts, t) {
  // Área própria (ADR-092): sem a imagem pronta, o redondo de reserva fica no meio da área.
  const span = hasSpan(token) ? visualBox(token, s, opts.free) : null;
  const cx = span ? span.x + span.w / 2 : (token.x + 0.5) * s,
    cy = span ? span.y + span.h / 2 : (token.y + 0.5) * s,
    radius = span ? Math.min(span.w, span.h) * 0.4 : s * 0.4 * tokenScale(token);
  // Imagem livre ainda carregando (ou com falha): desenha o redondo com as iniciais.
  if (isImageLook(token) && opts.portrait && drawFreeImage(g, token, s, opts, t, cx, cy)) return;
  g.save();
  if (opts.offline) g.globalAlpha = 0.42;
  if (token.hidden || token.perceived) g.globalAlpha = 0.55;
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
  const pictured = !!opts.portrait && drawPortrait(g, opts.portrait, cx, cy, radius);
  g.strokeStyle = SIDE[token.side] || SIDE.neutral;
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.lineWidth = Math.max(2, s * 0.07);
  // Oculto (mestre) ou percebido por sentido (jogador): contorno tracejado.
  if (token.hidden || token.perceived) g.setLineDash([s * 0.1, s * 0.07]);
  g.stroke();
  g.setLineDash([]);
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
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (!pictured) {
    g.font = `600 ${Math.max(9, s * 0.3 * Math.min(2, tokenScale(token)))}px Georgia, serif`;
    g.fillText(initials(token.label), cx, cy + s * 0.01);
  }
  drawLabel(g, token, s, cx, cy + radius + s * 0.04);
  g.restore();
}

const BUBBLE_TONE = { healthy: "#7cc35b", wounded: "#d9b44a", critical: "#d4533f", down: "#5d5850" };
/**
 * Bolhas de estado sobre o marcador (vida em barra e armadura em escudo). Devolve as áreas clicáveis
 * da barra de vida, em coordenadas do tabuleiro. Em casas pequenas a barra continua, sem números.
 */
function drawBubbles(g, token, s, bubble, free = false) {
  if (!bubble || s < 18) return null;
  const span = hasSpan(token) ? visualBox(token, s, free) : null;
  const cx = span ? span.x + span.w / 2 : (token.x + 0.5) * s, cy = span ? span.y + span.h / 2 : (token.y + 0.5) * s, radius = span ? span.h / 2 : s * tokenHalf(token);
  let hit = null;
  g.save();
  g.textAlign = "center";
  g.textBaseline = "middle";
  const r = bubble.resource;
  if (r) {
    // Números a partir de 20 px por casa; a barra cresce para caber o texto e nunca sai pelo topo do mapa.
    const numbers = s >= 20, text = r.max ? `${r.value}/${r.max}` : String(r.value);
    const h = numbers ? Math.max(10, s * 0.18) : Math.max(5, s * 0.17);
    g.font = `700 ${Math.max(8, h * 0.82)}px "Segoe UI", Arial, sans-serif`;
    const w = numbers ? Math.max(s * 0.92, g.measureText(text).width + 8) : s * 0.92;
    const x = cx - w / 2, y = Math.max(1, cy - radius - h - s * 0.04);
    g.fillStyle = "#0b0a08e6";
    roundRect(g, x - 1, y - 1, w + 2, h + 2, h / 2); g.fill();
    if (r.max) {
      const fill = Math.max(0, Math.min(1, r.value / r.max));
      g.fillStyle = BUBBLE_TONE[r.tone] || BUBBLE_TONE.healthy;
      if (fill > 0) { roundRect(g, x, y, Math.max(h, w * fill), h, h / 2); g.fill(); }
    } else {
      g.fillStyle = "#3b3226";
      roundRect(g, x, y, w, h, h / 2); g.fill();
    }
    g.strokeStyle = bubble.target ? "#f1d79ccc" : "#f1d79c55";
    g.lineWidth = 1;
    roundRect(g, x - 0.5, y - 0.5, w + 1, h + 1, h / 2); g.stroke();
    if (numbers) {
      g.lineWidth = Math.max(2, h * 0.22);
      g.strokeStyle = "#0b0a08";
      g.strokeText(text, cx, y + h / 2 + 0.5);
      g.fillStyle = "#fff8e8";
      g.fillText(text, cx, y + h / 2 + 0.5);
    }
    // Área de toque maior que a barra: alcança 44 px nos alvos móveis quando a casa permite.
    if (bubble.target) hit = { x: x - s * 0.05, y: y - s * 0.12, w: w + s * 0.1, h: h + s * 0.24 };
  }
  const a = bubble.armor;
  if (a && s >= 20) {
    const sr = Math.max(8, s * 0.17), sx = cx + radius * 0.86, sy = cy - radius * 0.32;
    g.beginPath();
    g.moveTo(sx, sy - sr);
    g.lineTo(sx + sr, sy - sr * 0.6);
    g.quadraticCurveTo(sx + sr, sy + sr * 0.6, sx, sy + sr * 1.05);
    g.quadraticCurveTo(sx - sr, sy + sr * 0.6, sx - sr, sy - sr * 0.6);
    g.closePath();
    g.fillStyle = "#1d2a38f2"; g.fill();
    g.strokeStyle = "#a9c1dd"; g.lineWidth = Math.max(1, s * 0.03); g.stroke();
    g.font = `700 ${Math.max(8, sr * (a.value.length > 2 ? 0.75 : 0.95))}px "Segoe UI", Arial, sans-serif`;
    g.fillStyle = "#eef5ff";
    g.fillText(a.value, sx, sy + sr * 0.05);
  }
  g.restore();
  return hit;
}

let boardSequence = 0;
export function createBoard(host, handlers = {}) {
  const instructionId = `camera-instruction-${++boardSequence}`;
  host.innerHTML = `<div class="board-surface"><canvas class="board-canvas" tabindex="0" role="application" aria-roledescription="tabuleiro" aria-label="Mapa tático. Use as setas para escolher uma casa e Enter para confirmar."></canvas><img class="board-image" alt="" hidden referrerpolicy="no-referrer"></div><p class="sr-only" aria-live="polite" data-board-status></p>`;
  const surface = host.querySelector(".board-surface");
  const canvas = host.querySelector("canvas"),
    image = host.querySelector("img"),
    status = host.querySelector("[data-board-status]");
  const g = canvas.getContext("2d");
  let state = null,
    view = { mode: "none", reach: [], selected: null, grid: true },
    layer = null,
    cell = 0,
    ox = 0,
    oy = 0,
    baseX = 0,
    baseY = 0,
    frame = 0,
    last = 0,
    cursor = null,
    dpr = 1;
  const moves = new Map();
  // Marcador solto aguardando o servidor: fica desenhado no destino (sem voltar à origem) até o estado novo chegar.
  // Recusa ou falta de confirmação devolve o marcador com a mesma animação curta.
  const landing = new Map();
  const placeKey = (t) => `${t.x}:${t.y}:${t.fx ?? ""}:${t.fy ?? ""}`;
  // Tamanho/área escolhidos na alça aguardando o servidor (mesma ideia de `landing`): campos a sobrepor ao marcador.
  const sizing = new Map();
  const sized = (t) => (sizing.has(t.id) ? { ...t, ...sizing.get(t.id).patch } : t);
  const resizing = (raw) => (resize?.token.id === raw.id ? { ...sized(raw), ...resize.patch } : sized(raw));
  let resize = null, handleHit = null; // alça de redimensionar (mestre) em andamento / desenhada no último quadro
  let drag = null, suppressClick = false; // arraste de marcador em andamento
  let bubbleHits = []; // barras de vida clicáveis desenhadas no último quadro (coordenadas do tabuleiro)
  const rows = () => state?.map?.rows || [];
  const tileset = () => state?.map?.kind === "tileset" && rows().length > 0;

  const uploaded = () => Number(state?.map?.gridPixels) >= 8;
  // Movimentação livre: o marcador fica no ponto fino; as contas de desenho usam o canto da "casa" fracionária.
  const free = () => tileset() && isFreeMap(state?.map);
  const visualOf = (token) => {
    if (!free()) return token;
    const c = tokenCenter(token, true);
    return { ...token, x: c.x - 0.5, y: c.y - 0.5 };
  };
  const compact = matchMedia("(max-width: 900px), (max-width: 1200px) and (pointer: coarse)");
  // Editor (ADR-081): roda = zoom no cursor, espaço/botão do meio = mover a vista; sem ampliação automática no celular.
  const editor = !!handlers.editor;
  let enlarged = !!handlers.camera && !editor && compact.matches, panning = enlarged, cameraDrag = null, panHold = false, panTool = false;
  // Zoom relativo a "ajustar à tela" (1). Só o editor afasta além disso: o mapa fica menor e centralizado no palco.
  const minZoom = editor ? .1 : 1;
  let zoomLevel = null, currentZoom = 1, maxZoom = 3, fitW = 0;
  let centerX = .5, centerY = .5, previousWidth = 0, previousHeight = 0, resetCamera = true;
  const camera = handlers.camera || editor ? document.createElement("div") : null;
  if (camera) {
    host.classList.add("board-viewport");
    camera.className = "map-camera-controls";
    camera.innerHTML = `<button type="button" class="subtle" data-camera="out" aria-label="Afastar mapa">−</button><button type="button" class="subtle" data-camera="in" aria-label="Aproximar mapa">+</button><button type="button" class="subtle" data-camera="size">Mapa inteiro</button><button type="button" class="subtle" data-camera="pan" aria-pressed="true" aria-describedby="${instructionId}">Arrastar mapa</button><span id="${instructionId}">Arraste para explorar</span><span class="camera-help">Visão${helpButton("mesa.mapa.camera", "Ampliar e percorrer o mapa")}</span>`;
    if (handlers.camera) handlers.camera.append(camera);
    camera.addEventListener("click", (e) => {
      const action = e.target.closest("[data-camera]")?.dataset.camera;
      if (action === "size") { enlarged = !enlarged; zoomLevel = null; panning = enlarged; resetCamera = true; layout(); draw(); }
      if (action === "in" || action === "out") zoomAt(currentZoom * (action === "in" ? 1.25 : .8));
      if (action === "pan") panning = !panning;
      updateCamera();
    });
  }
  function updateCamera() {
    if (!camera) return;
    camera.querySelector('[data-camera="size"]').textContent = enlarged ? "Mapa inteiro" : "Ampliar mapa";
    camera.querySelector('[data-camera="size"]').setAttribute("aria-pressed", String(enlarged));
    camera.querySelector('[data-camera="pan"]').setAttribute("aria-pressed", String(panning));
    camera.querySelector(`#${instructionId}`).textContent = panning ? "Arraste ou use dois dedos" : "Toque para interagir · pinça para zoom";
    host.classList.toggle("camera-pan", panning || panHold || panTool);
    canvas.style.touchAction = "none";
    host.dataset.zoom = currentZoom.toFixed(3);
    camera.querySelector('[data-camera="out"]').disabled = currentZoom <= 1.001;
    camera.querySelector('[data-camera="in"]').disabled = currentZoom >= maxZoom - .001;
  }
  // Fundo do mapa enviado em buffer duplo: a nova versão (mais casas exploradas) só substitui a atual depois de carregar.
  let background = null, pendingSrc = "";
  function loadBackground(src) {
    if (!src || src === pendingSrc) return;
    pendingSrc = src;
    const next = new Image();
    next.referrerPolicy = "no-referrer";
    next.onload = () => { if (pendingSrc !== src) return; background = next; layout(); draw(); };
    next.onerror = () => { if (pendingSrc === src) status.textContent = "Não foi possível carregar o mapa. Tente atualizar a mesa."; };
    next.src = src;
  }
  image.onerror = () => { status.textContent = "Não foi possível carregar o mapa. Tente atualizar a mesa."; };
  image.onload = () => { layout(); if (editor) handlers.onZoom?.(); };

  // Camada estática (ADR-081): desenhada fora da tela numa resolução própria e escalada ao desenhar.
  // O zoom reaproveita a camada atual e refaz a nitidez em fatias curtas, sem travar a interface; quando a grade muda
  // (pintura no editor, exploração na mesa), só as casas afetadas são repintadas.
  const LAYER_MAX = 4096, SLICE_MS = 10, REFINE_DELAY = 160;
  let layerInfo = null, job = null, jobTimer = 0;
  // Resolução da casa igual à do tabuleiro: o desenho de cada quadro vira uma cópia 1:1 (escala só durante o zoom).
  const layerScale = (r) => Math.max(4, Math.min(cell, Math.floor(LAYER_MAX / Math.max(r[0].length, r.length))));
  function cancelJob() { clearTimeout(jobTimer); jobTimer = 0; job = null; }
  function startJob(r, ground, s, info, delay) {
    cancelJob();
    const target = document.createElement("canvas");
    target.width = r[0].length * s; target.height = r.length * s;
    job = { target, g: target.getContext("2d"), rows: r, ground, s, i: 0, flags: tileFlags(r), info: { ...info, s, rows: r, ground } };
    // Sem camada para mostrar: a nova aparece enquanto é desenhada.
    if (!layer) { layer = target; layerInfo = job.info; }
    jobTimer = setTimeout(stepJob, delay);
  }
  function stepJob() {
    jobTimer = 0;
    if (!job || destroyed) return;
    const { rows: r, s, g: lg, flags, ground } = job, w = r[0].length, n = w * r.length, until = performance.now() + SLICE_MS;
    while (job.i < n && performance.now() < until) { drawTile(lg, r, job.i % w, (job.i / w) | 0, s, flags.outdoor, flags.timber, ground); job.i++; }
    if (job.i < n) { jobTimer = setTimeout(stepJob, 0); return; }
    vignette(lg, w * s, r.length * s);
    layer = job.target; layerInfo = job.info; job = null;
    syncLayer(); // o zoom pode ter mudado durante a montagem
    draw();
  }
  function repaint(target, info, r, ground, cells) {
    const lg = target.getContext("2d"), w = r[0].length, s = info.s, { outdoor, timber } = tileFlags(r);
    // Camada ainda sendo montada (sem vinheta): a vinheta entra no fim, para todas as casas.
    const finished = !job || job.target !== target;
    for (const i of cells) {
      const x = i % w, y = (i / w) | 0;
      lg.clearRect(x * s, y * s, s, s);
      drawTile(lg, r, x, y, s, outdoor, timber, ground);
      if (finished) vignette(lg, w * s, r.length * s, { x: x * s, y: y * s, size: s });
    }
    info.rows = r; info.ground = ground;
  }
  function syncLayer() {
    if (!tileset() || uploaded()) { cancelJob(); layer = null; layerInfo = null; return; }
    const r = rows(), ground = state.map.terrain || null, s = layerScale(r);
    const id = `${state.map.key}:${r[0].length}x${r.length}:${ground ? 1 : 0}`, globals = tileGlobals(r);
    const info = layerInfo;
    // Outro mapa, outro tamanho ou mudança global de piso: refaz tudo (já, sem esperar).
    if (!info || info.id !== id || info.globals !== globals) { layer = null; startJob(r, ground, s, { id, globals }, 0); return; }
    // Primeira montagem em andamento: só recomeça se a grade mudou; a resolução é revista ao terminar.
    if (job && job.target === layer) {
      if (info.rows !== r || info.ground !== ground) { layer = null; startJob(r, ground, s, { id, globals }, 0); }
      return;
    }
    if (info.rows !== r || info.ground !== ground) {
      const cells = affectedCells(info.rows, r, info.ground, ground);
      if (!cells) { startJob(r, ground, s, { id, globals }, 0); return; }
      if (cells.length) repaint(layer, info, r, ground, cells);
      else { info.rows = r; info.ground = ground; }
      // Nitidez em andamento com a grade antiga: recomeça com a nova.
      if (job && job.target !== layer) startJob(r, ground, job.s, { id, globals }, REFINE_DELAY);
    }
    // Zoom: a camada atual é escalada; a nova resolução é desenhada quando o zoom para.
    if (s !== info.s && (!job || job.s !== s)) startJob(r, ground, s, { id, globals }, REFINE_DELAY);
    else if (s === info.s && job && job.target !== layer) cancelJob();
  }
  /** Origem do tabuleiro no canvas visível: posição na superfície menos a rolagem atual. */
  function syncOrigin() {
    ox = baseX - Math.round(host.scrollLeft * dpr);
    oy = baseY - Math.round(host.scrollTop * dpr);
  }
  let scrollFrame = 0;
  host.addEventListener("scroll", () => {
    syncOrigin();
    if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; if (!destroyed) draw(); });
  }, { passive: true });
  function layout() {
    const rect = host.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    if (!resetCamera && previousWidth && previousHeight) {
      centerX = (host.scrollLeft + previousWidth / 2) / Math.max(1, surface.offsetWidth);
      centerY = (host.scrollTop + previousHeight / 2) / Math.max(1, surface.offsetHeight);
    }
    const ratio = tileset() ? rows()[0].length / rows().length : image.naturalWidth / image.naturalHeight;
    let width = host.clientWidth, height = host.clientHeight, contentW = 0, contentH = 0;
    if (Number.isFinite(ratio) && ratio > 0) {
      const fitWidth = Math.min(width, height * ratio), fitHeight = fitWidth / ratio;
      const cover = Math.max(width / fitWidth, height / fitHeight);
      maxZoom = editor ? Math.max(8, cover * 4) : Math.max(3, cover * 3);
      currentZoom = Math.max(minZoom, Math.min(maxZoom, zoomLevel ?? (enlarged ? cover : 1)));
      fitW = fitWidth;
      contentW = fitWidth * currentZoom; contentH = fitHeight * currentZoom;
      width = Math.max(width, contentW);
      height = Math.max(height, contentH);
    }
    surface.style.width = `${width}px`;
    surface.style.height = `${height}px`;
    // Imagem sem grade no editor: tamanho exato do zoom, centralizada (permite afastar abaixo de "ajustar à tela").
    if (editor && !tileset() && contentW > 0) {
      Object.assign(image.style, { position: "absolute", width: `${contentW}px`, height: `${contentH}px`, left: `${(width - contentW) / 2}px`, top: `${(height - contentH) / 2}px` });
    }
    // O canvas cobre só a área visível (fixo na rolagem); a superfície ampliada só dá a extensão da rolagem.
    // Assim cada quadro desenha a janela visível, não o mapa ampliado inteiro.
    const viewW = Math.max(1, host.clientWidth), viewH = Math.max(1, host.clientHeight);
    dpr = Math.min(2, window.devicePixelRatio || 1, 4096 / Math.max(viewW, viewH));
    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
    canvas.style.width = `${viewW}px`;
    canvas.style.height = `${viewH}px`;
    if (resetCamera) {
      const mine = (state?.tokens || []).find(t => t.characterId && t.characterId === state?.me?.characterId);
      const at = mine && tileset() ? tokenCenter(mine, free()) : null;
      centerX = at ? at.x / rows()[0].length : .5;
      centerY = at ? at.y / rows().length : .5;
      resetCamera = false;
    }
    host.scrollLeft = centerX * width - host.clientWidth / 2;
    host.scrollTop = centerY * height - host.clientHeight / 2;
    previousWidth = host.clientWidth; previousHeight = host.clientHeight;
    updateCamera();
    if (!tileset()) return;
    const r = rows();
    // Casa em pixels inteiros: camada em cache alinhada (repintura sem emendas) e grade nítida.
    // A casa sai do conteúdo ampliado (não da superfície), para o zoom abaixo de "ajustar à tela" também reduzir o mapa.
    cell = Math.max(
      1,
      Math.floor(Math.min((contentW || width) * dpr / r[0].length, (contentH || height) * dpr / r.length)),
    );
    baseX = Math.floor((width * dpr - cell * r[0].length) / 2);
    baseY = Math.floor((height * dpr - cell * r.length) / 2);
    syncOrigin();
    syncLayer();
  }
  function zoomAt(value, clientX, clientY) {
    if (!camera) return;
    const rect = host.getBoundingClientRect();
    const x = clientX == null ? host.clientWidth / 2 : clientX - rect.left;
    const y = clientY == null ? host.clientHeight / 2 : clientY - rect.top;
    const anchorX = (host.scrollLeft + x) / Math.max(1, surface.offsetWidth);
    const anchorY = (host.scrollTop + y) / Math.max(1, surface.offsetHeight);
    zoomLevel = Math.max(minZoom, Math.min(maxZoom, value));
    enlarged = zoomLevel > 1.001;
    layout();
    host.scrollLeft = anchorX * surface.offsetWidth - x;
    host.scrollTop = anchorY * surface.offsetHeight - y;
    draw(); updateCamera();
  }
  function draw(t = performance.now()) {
    if (!tileset() || (!uploaded() && !layer) || host.clientHeight < 1) return;
    const animate = !reduceMotion();
    syncOrigin();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#0b0a08";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.translate(ox, oy);
    const r = rows();
    if (uploaded()) {
      // A grade começa no deslocamento definido no mapa (mesma grade autoritativa do servidor).
      if (background?.naturalWidth) g.drawImage(background, Number(state.map.gridOffsetX) || 0, Number(state.map.gridOffsetY) || 0, r[0].length * state.map.gridPixels, r.length * state.map.gridPixels, 0, 0, r[0].length * cell, r.length * cell);
    } else {
      const bw = r[0].length * cell, bh = r.length * cell;
      g.imageSmoothingEnabled = true;
      if (layerInfo?.s === cell) g.drawImage(layer, 0, 0);
      else g.drawImage(layer, 0, 0, bw, bh);
      drawWater(g, r, cell, animate ? t : 0);
      drawLights(g, r, cell, t, animate);
    }
    drawFog(g, state, view, cell, t, animate);
    for (const token of state.tokens || []) if (token.light > 0 && !token.hidden) { const v = visualOf(token); drawGlow(g, v.x, v.y, token.light, cell, t, animate); }
    drawDiagnostic(g, view.diagnostic, r[0].length, r.length, cell);
    drawVectorOverlay(g, view.vector, state.fog?.walls, cell);
    if (view.paint?.length) {
      g.fillStyle = "rgba(241,215,156,.28)";
      for (const c of view.paint) g.fillRect(c.x * cell + 1, c.y * cell + 1, cell - 2, cell - 2);
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
    if (view.reachCircle) {
      // Movimentação livre: o alcance em linha reta aparece como círculo em volta do marcador.
      const rc = view.reachCircle;
      g.save();
      g.setLineDash([cell * 0.18, cell * 0.12]);
      g.strokeStyle = "rgba(241,215,156,.7)";
      g.lineWidth = Math.max(1.5, cell * 0.05);
      g.beginPath();
      g.arc(rc.x * cell, rc.y * cell, rc.r * cell, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    if (view.attack?.length) {
      // Alcance de ataque: área avermelhada com contorno só na borda externa.
      const inside = new Set(view.attack.map((c) => c.x + ":" + c.y));
      g.fillStyle = "rgba(212,83,63,.10)";
      g.strokeStyle = "rgba(230,110,90,.75)";
      g.lineWidth = Math.max(1.5, cell * 0.05);
      g.beginPath();
      for (const c of view.attack) {
        g.fillRect(c.x * cell, c.y * cell, cell, cell);
        const x = c.x * cell, y = c.y * cell;
        const edge = (dx, dy) => !inside.has(c.x + dx + ":" + (c.y + dy)) && !(state.tokens || []).some((t) => t.x === c.x + dx && t.y === c.y + dy && t.characterId === state.me?.characterId);
        if (edge(0, -1)) { g.moveTo(x, y); g.lineTo(x + cell, y); }
        if (edge(0, 1)) { g.moveTo(x, y + cell); g.lineTo(x + cell, y + cell); }
        if (edge(-1, 0)) { g.moveTo(x, y); g.lineTo(x, y + cell); }
        if (edge(1, 0)) { g.moveTo(x + cell, y); g.lineTo(x + cell, y + cell); }
      }
      g.stroke();
    }
    const online = new Set(
      (state.participants || [])
        .filter((p) => p.online)
        .map((p) => p.characterId),
    );
    bubbleHits = [];
    // Maiores primeiro: marcadores pequenos ficam por cima de uma criatura grande.
    for (const raw of drawOrder(state.tokens)) {
      if (drag?.moved && drag.token.id === raw.id) continue;
      const token = resizing(raw);
      const land = landing.get(token.id);
      const move = land ? null : moves.get(token.id);
      const fraction = !animate || !move ? 1 : Math.min(1, (t - move.started) / 180);
      const eased = 1 - (1 - fraction) ** 3;
      // Durante o arraste de uma alça, a área segue o ponteiro (sem a animação de pouso).
      const placed = land && resize?.token.id !== token.id ? { ...token, x: land.x, y: land.y } : visualOf(token);
      const visual = move && fraction < 1 ? { ...placed, x: move.x + (placed.x - move.x) * eased, y: move.y + (placed.y - move.y) * eased } : placed;
      if (fraction >= 1) moves.delete(token.id);
      // Opacidade/visibilidade de camada no editor (organização visual; não muda o que os jogadores veem).
      if (token.alpha === 0) continue;
      if (token.alpha != null && token.alpha < 1) { g.save(); g.globalAlpha = token.alpha; }
      drawToken(
        g,
        visual,
        cell,
        {
          active:
            token.characterId &&
            token.characterId === state.session.activeCharacterId,
          mine: token.characterId && token.characterId === state.me.characterId,
          selected: token.id === view.selected || !!view.selectedIds?.includes(token.id),
          offline: token.characterId && !online.has(token.characterId),
          animate,
          portrait: portraitFor(token.image, redraw),
          free: free(),
        },
        t,
      );
      if (token.alpha != null && token.alpha < 1) g.restore();
      const hit = view.bubbles === false ? null : drawBubbles(g, visual, cell, token.bubble, free());
      if (hit) bubbleHits.push({ ...hit, token });
    }
    drawHandle();
    if (drag?.moved) {
      // Boneco arrastado acompanha o ponteiro; a casa de destino fica marcada.
      g.strokeStyle = "#f1d79c";
      g.lineWidth = 2;
      // Criatura grande no tático: marca a área inteira de destino.
      const area = tokenSpan(drag.token);
      if (drag.cell && !free()) g.strokeRect(drag.cell.x * cell + 2, drag.cell.y * cell + 2, cell * area.w - 4, cell * area.h - 4);
      g.save();
      g.globalAlpha = 0.85;
      drawToken(g, { ...drag.token, x: drag.px / cell - 0.5, y: drag.py / cell - 0.5 }, cell, { mine: true, selected: true, animate: false, portrait: portraitFor(drag.token.image), free: free() }, t);
      g.restore();
    }
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
  /** Alça no canto do marcador selecionado: o mestre arrasta para mudar o tamanho (o modal "Aparência" tem o campo numérico). */
  function drawHandle() {
    handleHit = null;
    if (!view.resizable || !view.selected || drag?.moved || !state.tokens) return;
    const raw = state.tokens.find((t) => t.id === view.selected);
    if (!raw) return;
    const token = resizing(raw);
    const land = landing.get(token.id);
    const v = land && !resize ? { x: land.x, y: land.y } : visualOf(token);
    // Imagem livre: oito alças (cantos e lados) mudam largura e altura em qualquer direção (ADR-092).
    if (isImageLook(token) && token.image) return drawSpanHandles(raw, token, v);
    const half = tokenHalf(token) * cell;
    let x = (v.x + 0.5) * cell + half, y = (v.y + 0.5) * cell + half;
    // Imagem livre: alça no canto da figura (proporção da imagem), não do quadrado.
    const img = isImageLook(token) ? portraitFor(token.image) : null;
    if (img) {
      const box = imageBox((v.x + 0.5) * cell, (v.y + 0.5) * cell, cell * tokenScale(token), img.naturalWidth || img.width, img.naturalHeight || img.height);
      x = box.x + box.w; y = box.y + box.h;
    }
    const r = Math.max(7, cell * 0.14) * Math.max(1, dpr * 0.75);
    g.save();
    g.fillStyle = "#f1d79c";
    g.strokeStyle = "#0b0a08";
    g.lineWidth = Math.max(1.5, dpr);
    g.beginPath();
    g.rect(x - r / 2, y - r / 2, r, r);
    g.fill();
    g.stroke();
    if (resize) handleReadout(`${token.size ?? 100}%`, x + r, y, r);
    g.restore();
    // Alvo de toque com folga (dedo): ao menos 22 px de raio em pixels de tela.
    handleHit = { kind: "size", x, y, r: Math.max(r, 22 * dpr), token: raw, center: { x: (v.x + 0.5), y: (v.y + 0.5) } };
  }
  /** Rótulo escuro ao lado da alça durante o arraste (tamanho ou área). */
  function handleReadout(text, x, y, r) {
    g.font = `700 ${Math.max(11, cell * 0.22)}px "Segoe UI", Arial, sans-serif`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    const w = g.measureText(text).width + 10;
    g.fillStyle = "#0b0a08e6";
    roundRect(g, x, y - r, w, r * 2, 4);
    g.fill();
    g.fillStyle = "#f6ead0";
    g.fillText(text, x + 5, y);
  }
  /** Área da imagem em casas a partir da posição visual: própria (tático = casas; livre = centrada) ou o quadrado do tamanho. */
  function cellBox(token, v) {
    if (hasSpan(token)) { const b = visualBox({ ...token, x: v.x, y: v.y }, 1, free()); return b; }
    const half = tokenHalf(token);
    return { x: v.x + 0.5 - half, y: v.y + 0.5 - half, w: half * 2, h: half * 2 };
  }
  function drawSpanHandles(raw, token, v) {
    const box = cellBox(token, v);
    const r = Math.max(7, cell * 0.12) * Math.max(1, dpr * 0.75);
    const points = SPAN_HANDLES.map((h) => ({ handle: h, x: (box.x + box.w * (h.dx + 1) / 2) * cell, y: (box.y + box.h * (h.dy + 1) / 2) * cell }));
    g.save();
    g.strokeStyle = "#f1d79c";
    g.lineWidth = Math.max(1, dpr);
    g.setLineDash([cell * 0.08, cell * 0.06]);
    g.strokeRect(box.x * cell, box.y * cell, box.w * cell, box.h * cell);
    g.setLineDash([]);
    g.fillStyle = "#f1d79c";
    g.strokeStyle = "#0b0a08";
    g.lineWidth = Math.max(1.5, dpr);
    for (const p of points) { g.beginPath(); g.rect(p.x - r / 2, p.y - r / 2, r, r); g.fill(); g.stroke(); }
    if (resize && hasSpan(token)) { const se = points[4]; handleReadout(spanLabel(token, free()), se.x + r, se.y, r); }
    g.restore();
    handleHit = { kind: "span", box, points, r: Math.max(r, 22 * dpr), token: raw };
  }
  // Retrato que terminou de carregar: redesenha uma vez.
  let destroyed = false;
  function redraw() { if (!destroyed) draw(); }
  function loop(t) {
    if (document.hidden) { frame = 0; return; }
    frame = requestAnimationFrame(loop);
    if (t - last < 50) return; // 20 fps para efeitos ambientais; interações redesenham imediatamente.
    last = t;
    draw(t);
  }
  function restart() {
    cancelAnimationFrame(frame);
    if (document.hidden) return;
    if (tileset() && !reduceMotion()) frame = requestAnimationFrame(loop);
    else draw();
  }
  function cellAt(clientX, clientY) {
    if (!tileset() || cell <= 0) return null;
    syncOrigin();
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) * dpr - ox) / cell),
      y = Math.floor(((clientY - rect.top) * dpr - oy) / cell);
    // cx/cy (fracionários) ajudam a achar marcadores maiores que uma casa; escritas usam só x/y.
    return x >= 0 && y >= 0 && x < rows()[0].length && y < rows().length
      ? { x, y, cx: ((clientX - rect.left) * dpr - ox) / cell, cy: ((clientY - rect.top) * dpr - oy) / cell }
      : null;
  }
  /**
   * Ponto do ponteiro. Com grade: a casa. Movimentação livre: a casa + posição fina (fx/fy) e o ponto
   * fracionário (cx/cy) para achar o marcador mais próximo.
   */
  function pointAt(clientX, clientY) {
    if (!free()) return cellAt(clientX, clientY);
    if (cell <= 0) return null;
    syncOrigin();
    const rect = canvas.getBoundingClientRect();
    const cx = ((clientX - rect.left) * dpr - ox) / cell, cy = ((clientY - rect.top) * dpr - oy) / cell;
    const p = finePoint(cx, cy, rows()[0].length, rows().length);
    return p && { ...p, cx, cy };
  }
  // Teclado (sem cx/cy) continua por casa; o ponteiro acha também marcadores maiores que uma casa (o menor fica por cima).
  const tokenAt = (c) => c.cx != null
    ? tokenUnder((state.tokens || []).map(sized), c.cx, c.cy, (t) => tokenCenter(t, free()), free())
    : (state.tokens || []).find((t) => (free() ? t.x === c.x && t.y === c.y : covers(t, c.x, c.y)));
  function activate(c) {
    if (!c) return;
    const token = tokenAt(c);
    if (token) handlers.onToken?.(token, c);
    else handlers.onCell?.(c);
  }
  // A câmera só desloca a visão local; nunca move marcadores nem pinta névoa.
  host.addEventListener("pointerdown", (e) => {
    const middle = editor && e.button === 1;
    if (!middle && (!(panning || panHold || panTool) || e.button !== 0)) return;
    e.preventDefault();
    cameraDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: host.scrollLeft, top: host.scrollTop };
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener("pointermove", (e) => {
    if (!cameraDrag || e.pointerId !== cameraDrag.id) return;
    host.scrollLeft = cameraDrag.left + cameraDrag.x - e.clientX;
    host.scrollTop = cameraDrag.top + cameraDrag.y - e.clientY;
    if (Math.hypot(e.clientX - cameraDrag.x, e.clientY - cameraDrag.y) > 6) cameraDrag.moved = true;
  });
  // Arrastar a câmera não conta como toque na barra de vida nem numa casa.
  const endCameraDrag = () => { if (cameraDrag?.moved) suppressClick = true; cameraDrag = null; };
  host.addEventListener("pointerup", endCameraDrag);
  host.addEventListener("pointercancel", endCameraDrag);
  // Arrastar marcador: o jogador arrasta o próprio boneco no turno; o mestre arrasta qualquer marcador.
  const boardPoint = (e) => {
    syncOrigin();
    const rect = canvas.getBoundingClientRect();
    return { px: (e.clientX - rect.left) * dpr - ox, py: (e.clientY - rect.top) * dpr - oy };
  };
  canvas.addEventListener("pointerdown", (e) => {
    suppressClick = false;
    if (panning || panHold || panTool || e.button !== 0 || view.mode === "paint" || view.mode === "vector" || !tileset()) return;
    const p = boardPoint(e);
    const grabbed = handleHit && handlers.onResize && (handleHit.kind === "span"
      ? handleHit.points.map((q) => ({ ...q, d: Math.hypot(p.px - q.x, p.py - q.y) })).filter((q) => q.d <= handleHit.r).sort((a, b) => a.d - b.d)[0]
      : Math.hypot(p.px - handleHit.x, p.py - handleHit.y) <= handleHit.r && handleHit);
    if (grabbed) {
      e.preventDefault();
      resize = handleHit.kind === "span"
        ? { kind: "span", token: handleHit.token, handle: grabbed.handle, box: handleHit.box, patch: null, pointer: e.pointerId }
        : { kind: "size", token: handleHit.token, center: handleHit.center, patch: null, pointer: e.pointerId };
      canvas.setPointerCapture?.(e.pointerId);
      canvas.style.touchAction = "none";
      return;
    }
    if (!view.draggable) return;
    const c = pointAt(e.clientX, e.clientY);
    const token = c && tokenAt(c);
    if (!token || (view.draggable !== "*" && view.draggable !== token.id)) return;
    // Pega o marcador onde foi tocado: o centro acompanha o ponteiro com a mesma distância (importa em marcadores grandes).
    const center = tokenCenter(token, free());
    const grab = { x: (p.px - center.x * cell) / dpr, y: (p.py - center.y * cell) / dpr };
    drag = { token, start: c, cell: c, moved: false, pointer: e.pointerId, grab, ...p };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (resize && e.pointerId === resize.pointer) {
      const p = boardPoint(e), point = { x: p.px / cell, y: p.py / cell };
      let patch;
      if (resize.kind === "span") {
        // Lado ou canto puxado segue o ponteiro; o oposto fica parado. Tático: casas inteiras; livre: qualquer tamanho.
        const box = boxFromHandle(resize.box, resize.handle, point, free(), rows()[0].length, rows().length);
        patch = { appearance: LOOK_IMAGE, ...spanFromBox(box, free()) };
      } else patch = { size: sizeFromHandle(resize.center, point, sized(resize.token)) };
      if (JSON.stringify(patch) !== JSON.stringify(resize.patch)) { resize.patch = patch; draw(); }
      return;
    }
    if (!drag || e.pointerId !== drag.pointer) return;
    const p = boardPoint(e);
    if (!drag.moved && Math.hypot(p.px - drag.px, p.py - drag.py) < cell * 0.25) return;
    if (!drag.moved) { drag.moved = true; canvas.setPointerCapture?.(e.pointerId); canvas.style.touchAction = "none"; }
    const gx = drag.grab.x * dpr, gy = drag.grab.y * dpr;
    Object.assign(drag, { px: p.px - gx, py: p.py - gy, cell: pointAt(e.clientX - drag.grab.x, e.clientY - drag.grab.y) });
    draw();
  });
  const endDrag = (e, cancel = false) => {
    if (resize && e.pointerId === resize.pointer) return finishResize(cancel);
    if (!drag || e.pointerId !== drag.pointer) return;
    const { token, start, cell: target, moved } = drag;
    drag = null;
    canvas.style.touchAction = view.mode === "paint" || view.mode === "vector" ? "none" : "";
    if (!moved) return;
    suppressClick = true;
    draw();
    // Livre: qualquer arraste muda o ponto, mesmo dentro da mesma casa.
    if (!cancel && target && handlers.onDrop && (free() || target.x !== start.x || target.y !== start.y)) {
      status.textContent = `${token.label} solto na coluna ${target.x + 1}, linha ${target.y + 1}.`;
      const entry = free() && target.cx != null
        ? { x: target.cx - 0.5, y: target.cy - 0.5, key: placeKey(token) }
        : { x: target.x, y: target.y, key: placeKey(token) };
      landing.set(token.id, entry);
      draw();
      // onDrop devolve false quando a jogada foi recusada; sem estado novo em alguns segundos, o marcador volta.
      Promise.resolve(handlers.onDrop(token, target))
        .then((ok) => ok === false ? settle(token.id, entry) : setTimeout(() => settle(token.id, entry), 5000))
        .catch(() => settle(token.id, entry));
    }
  };
  /**
   * Solta a alça: o tamanho (ou a área e a posição, na imagem livre) fica desenhado até o servidor confirmar; recusa ou
   * silêncio devolvem o anterior. `onResize(token, patch)` recebe só os campos alterados.
   */
  function finishResize(cancel) {
    const { token, patch } = resize;
    resize = null;
    canvas.style.touchAction = view.mode === "paint" || view.mode === "vector" ? "none" : "";
    suppressClick = true;
    const current = sized(token);
    if (cancel || !patch || Object.keys(patch).every((k) => patch[k] === (current[k] ?? (k === "size" ? 100 : null)))) { draw(); return; }
    const entry = { patch };
    sizing.set(token.id, entry);
    const next = { ...current, ...patch };
    status.textContent = hasSpan(next) ? `${token.label}: ${spanLabel(next, free())}.` : `${token.label}: tamanho ${next.size ?? 100}% da casa.`;
    draw();
    Promise.resolve(handlers.onResize(token, patch))
      .then((ok) => ok === false ? unsize(token.id, entry) : setTimeout(() => unsize(token.id, entry), 5000))
      .catch(() => unsize(token.id, entry));
  }
  function unsize(id, entry) {
    if (destroyed || sizing.get(id) !== entry) return;
    sizing.delete(id);
    draw();
  }
  function settle(id, entry) {
    if (destroyed || landing.get(id) !== entry) return;
    landing.delete(id);
    if (!reduceMotion()) moves.set(id, { x: entry.x, y: entry.y, started: performance.now() });
    draw();
  }
  canvas.addEventListener("pointerup", (e) => endDrag(e));
  canvas.addEventListener("pointercancel", (e) => endDrag(e, true));

  // Pintura por arraste (mestre): junta as casas e envia uma única escrita ao soltar.
  let stroke = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (panning || panHold || panTool || e.button !== 0 || view.mode !== "paint" || !tileset()) return;
    const c = cellAt(e.clientX, e.clientY);
    if (!c) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    stroke = new Map([[c.x + ":" + c.y, c]]);
    view = { ...view, paint: [c] };
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!stroke) return;
    const c = cellAt(e.clientX, e.clientY);
    if (!c || stroke.has(c.x + ":" + c.y) || stroke.size >= 4096) return;
    stroke.set(c.x + ":" + c.y, c);
    view = { ...view, paint: [...stroke.values()] };
    draw();
  });
  const disposeGestures = camera ? mountMapGestures(host, {
    scale: () => currentZoom, zoom: zoomAt,
    cancel: () => { drag = null; resize = null; stroke = null; cameraDrag = null; suppressClick = true; view = { ...view, paint: [] }; draw(); },
  }) : () => {};
  const finishStroke = (e) => {
    if (!stroke) return;
    const cells = [...stroke.values()];
    stroke = null;
    view = { ...view, paint: [] };
    draw();
    handlers.onPaint?.(cells, cellAt(e.clientX, e.clientY));
  };
  canvas.addEventListener("pointerup", finishStroke);
  // Paredes vetoriais (ADR-087): ponto exato do ponteiro em centésimos de casa, independente do zoom.
  const worldAt = (e) => { const { px, py } = boardPoint(e); return cell > 0 ? { x: Math.round((px / cell) * WALL_UNIT), y: Math.round((py / cell) * WALL_UNIT) } : null; };
  let vectorPointer = null;
  const vectorEvent = (type, e) => {
    const p = worldAt(e);
    if (p) handlers.onVector?.({ type, ...p, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey || e.metaKey, button: e.button, pixels: cell / dpr });
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (view.mode !== "vector" || panning || panHold || panTool || e.button !== 0 || !tileset()) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(e.pointerId);
    vectorPointer = e.pointerId;
    vectorEvent("down", e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (view.mode !== "vector" || cameraDrag) return;
    vectorEvent(vectorPointer === e.pointerId ? "drag" : "move", e);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (vectorPointer !== e.pointerId) return;
    vectorPointer = null;
    if (view.mode === "vector") vectorEvent("up", e);
  });
  canvas.addEventListener("pointercancel", (e) => { if (vectorPointer === e.pointerId) { vectorPointer = null; handlers.onVector?.({ type: "cancel" }); } });
  canvas.addEventListener("dblclick", (e) => { if (view.mode === "vector") { e.preventDefault(); vectorEvent("dbl", e); } });
  canvas.addEventListener("pointercancel", () => { stroke = null; view = { ...view, paint: [] }; draw(); });
  const bubbleAt = (e) => {
    if (!handlers.onBubble || !bubbleHits.length) return null;
    const { px, py } = boardPoint(e);
    // Último desenhado fica por cima: procura de trás para frente.
    for (let i = bubbleHits.length - 1; i >= 0; i--) {
      const b = bubbleHits[i];
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.token;
    }
    return null;
  };
  canvas.addEventListener("click", (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (panHold || panTool) return;
    if (view.mode === "paint" || view.mode === "vector") return;
    // Névoa, paredes, luzes e marcas continuam por casa; posicionar usa o ponto fino no modo livre.
    if (view.mode === "fog") { if (!panning) activate(cellAt(e.clientX, e.clientY)); return; }
    if (view.mode === "place") { if (!panning) activate(pointAt(e.clientX, e.clientY)); return; }
    // A barra de vida responde mesmo com "Arrastar mapa" ligado: o toque curto não desloca a câmera.
    const bubble = bubbleAt(e);
    if (bubble) { handlers.onBubble(bubble); return; }
    if (panning) return;
    activate(pointAt(e.clientX, e.clientY));
  });
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
      if (enlarged) {
        host.scrollLeft = (baseX + (cursor.x + .5) * cell) / dpr - host.clientWidth / 2;
        host.scrollTop = (baseY + (cursor.y + .5) * cell) / dpr - host.clientHeight / 2;
      }
      draw();
    } else if ((e.key === "Enter" || e.key === " ") && cursor) {
      e.preventDefault();
      if (view.mode === "paint") handlers.onPaint?.([cursor]);
      else activate(cursor);
    } else if (e.key === "Escape" && !e.defaultPrevented && !dismissHelp()) handlers.onCancel?.();
  });
  canvas.addEventListener("blur", () => {
    cursor = null;
    draw();
  });
  // ---------- Extras do editor (ADR-081) ----------
  if (editor) {
    host.addEventListener("wheel", (e) => {
      // Imagem sem grade também aproxima com a roda, depois de carregada.
      if (!tileset() && !uploaded() && !(image.naturalWidth > 0)) return;
      e.preventDefault();
      const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY * (e.deltaMode === 1 ? 16 : 1))) / 240);
      zoomAt(currentZoom * factor, e.clientX, e.clientY);
      handlers.onZoom?.();
    }, { passive: false });
    host.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
    canvas.addEventListener("pointermove", (e) => { if (!cameraDrag) handlers.onHover?.(pointAt(e.clientX, e.clientY)); });
    canvas.addEventListener("pointerleave", () => handlers.onHover?.(null));
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const c = pointAt(e.clientX, e.clientY);
      handlers.onContext?.({ cell: c, token: c ? tokenAt(c) || null : null, x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener("keydown", (e) => {
      if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && cursor) {
        e.preventDefault();
        syncOrigin();
        const rect = canvas.getBoundingClientRect();
        handlers.onContext?.({ cell: cursor, token: (state.tokens || []).find((t) => t.x === cursor.x && t.y === cursor.y) || null, x: rect.left + (ox + (cursor.x + 1) * cell) / dpr, y: rect.top + (oy + (cursor.y + 1) * cell) / dpr });
      }
    });
  }
  const observer = new ResizeObserver(() => {
    layout();
    draw();
    if (editor) handlers.onZoom?.();
  });
  observer.observe(host);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener?.("change", restart);
  document.addEventListener("visibilitychange", restart);

  return {
    update(next, nextView = view) {
      const previousKey = state?.map?.key;
      if (previousKey !== next.map.key) { moves.clear(); landing.clear(); sizing.clear(); resize = null; resetCamera = true; }
      else {
        const previous = new Map((state?.tokens || []).map(token => [token.id, token]));
        const now = performance.now();
        for (const token of next.tokens || []) {
          const land = landing.get(token.id);
          if (land) {
            // Estado sem a jogada ainda (outra escrita da mesa): continua no ponto solto.
            if (placeKey(token) === land.key) continue;
            // Jogada confirmada: só o ajuste fino até o centro oficial, sem passar pela origem.
            landing.delete(token.id);
            if (!reduceMotion()) moves.set(token.id, { x: land.x, y: land.y, started: now });
            continue;
          }
          if (reduceMotion()) continue;
          const old = previous.get(token.id);
          // Mesmo mapa: anima da posição desenhada anterior (inclui a posição fina no modo livre).
          if (old && (old.x !== token.x || old.y !== token.y || old.fx !== token.fx || old.fy !== token.fy)) {
            const from = visualOf(old);
            moves.set(token.id, { x: from.x, y: from.y, started: now });
          }
        }
        for (const id of moves.keys()) if (!(next.tokens || []).some(token => token.id === id)) moves.delete(id);
        for (const id of landing.keys()) if (!(next.tokens || []).some(token => token.id === id)) landing.delete(id);
        // Tamanho confirmado (ou marcador removido): para de sobrepor o valor do servidor.
        for (const [id, entry] of sizing) if (!(next.tokens || []).some(token => token.id === id && token.size !== entry.size)) sizing.delete(id);
      }
      state = next;
      view = { ...view, ...nextView };
      const isTile = tileset();
      canvas.hidden = !isTile && !uploaded();
      image.hidden = isTile || uploaded();
      canvas.setAttribute("aria-label", free()
        ? `Mapa com movimentação livre ${state.map.name}. Toque ou arraste para posicionar em qualquer ponto; cada quadrado de referência representa ${state.map.scaleMeters} metros. Pelo teclado, as setas escolhem uma área e Enter confirma no centro dela.`
        : uploaded() ? `Mapa tático ${state.map.name}. Cada quadrado representa ${state.map.scaleMeters} metros. Use as setas para escolher uma casa e Enter para confirmar.` : "Mapa tático. Use as setas para escolher uma casa e Enter para confirmar.");
      const src = state.map.imageUrl || "";
      if (uploaded()) loadBackground(src);
      else if (src && image.getAttribute("src") !== src) image.src = src;
      image.alt = "Mapa: " + state.map.name;
      canvas.style.touchAction = view.mode === "paint" || view.mode === "vector" ? "none" : "";
      updateCamera();
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
      if (camera) panning = false;
      view = { ...view, ...nextView };
      canvas.style.touchAction = view.mode === "paint" || view.mode === "vector" ? "none" : "";
      updateCamera();
      draw();
    },
    interact() { panning = false; updateCamera(); },
    /** Câmera do editor: zoom ancorado, ajustar, 100% (`natural` = pixels por casa no tamanho real), mão e espaço. */
    camera: {
      zoomIn: () => zoomAt(currentZoom * 1.25),
      zoomOut: () => zoomAt(currentZoom / 1.25),
      fit: () => { zoomLevel = 1; enlarged = false; resetCamera = true; layout(); draw(); updateCamera(); },
      // Imagem sem grade: 100% = um pixel da imagem por pixel da tela (não há casas para medir).
      actual: (natural = 64) => {
        if (!tileset()) { if (image.naturalWidth > 0 && fitW > 0) zoomAt(image.naturalWidth / fitW); return; }
        const fitCell = cell / dpr / currentZoom; if (fitCell > 0) zoomAt(natural / fitCell);
      },
      zoom: (natural = 64) => {
        if (!tileset()) return image.naturalWidth > 0 && fitW > 0 ? fitW * currentZoom / image.naturalWidth : 1;
        return cell > 0 ? cell / dpr / natural : 1;
      },
      setPanHold: (on) => { panHold = !!on; host.classList.toggle("camera-pan", panHold || panTool || panning); },
      setPan: (on) => { panTool = !!on; host.classList.toggle("camera-pan", panHold || panTool || panning); },
      cellAt: (x, y) => cellAt(x, y),
      pointAt: (x, y) => pointAt(x, y),
      /** Retângulo de uma casa em coordenadas da janela (para posicionar menus/alças). */
      cellRect: (c) => { syncOrigin(); const r = canvas.getBoundingClientRect(); return { x: r.left + (ox + c.x * cell) / dpr, y: r.top + (oy + c.y * cell) / dpr, size: cell / dpr }; },
    },
    focus() {
      canvas.focus();
    },
    destroy() {
      destroyed = true;
      cancelJob();
      cancelAnimationFrame(scrollFrame);
      moves.clear();
      landing.clear();
      sizing.clear();
      cancelAnimationFrame(frame);
      pendingSrc = "";
      image.onload = null; image.onerror = null;
      disposeGestures();
      camera?.remove();
      observer.disconnect();
      motion.removeEventListener?.("change", restart);
      document.removeEventListener("visibilitychange", restart);
    },
  };
}
import { dismissHelp } from "./help.js";
