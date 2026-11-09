// Integração PostgreSQL da névoa: migração, filtragem por jogador, movimento por casas conhecidas, preparação com revisão,
// imagem mascarada dos mapas enviados, configuração por sessão/campanha e corrida entre pintura do mestre e movimento.
import { readFile } from "node:fs/promises";
import { startEnvironment } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5231 });
const { check, ok } = env;
const systemId = "00000000-0000-4000-8000-000000000001";
try {
  const master = await env.verifiedClient("mestre.nevoa@example.test", "Mestre");
  const player = await env.verifiedClient("jogador.nevoa@example.test", "Ana");
  const campaign = await master("/api/campaigns", "POST", { name: "Cripta escura", description: "Névoa", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  await player("/api/campaigns/join", "POST", { code: (await master(path)).inviteCode });
  const character = await player("/api/characters", "POST", { name: "Lira", archetype: "Batedora", level: 1, hp: 10, maxHp: 10, strength: 10, agility: 10, intellect: 10, notes: "", movement: 9 });

  // Padrão: névoa ativa, herdada do sistema.
  const initial = await master(path + "/table-settings");
  check([initial.inherited, initial.settings.fogEnabled], [true, true]);
  await player(path + "/table-settings", "GET", undefined, 403);

  const session = await master(path + "/sessions", "POST", { title: "Descida", objective: "", mapKind: "tileset", mapKey: "crypt" });
  const s = `/api/sessions/${session.id}`;
  await player(s + "/join", "POST", { characterId: character.id }, 204);
  await master(s + "/tokens", "POST", { label: "Espectro", side: "enemy", x: 3, y: 8 });
  let live = await player(s + "/live");
  check(live.fog.active, true);
  ok(live.map.rows[0].includes("?"), "terreno nunca visto não chega ao jogador");
  ok(!JSON.stringify(live).includes("Espectro"), "criatura no escuro não chega ao jogador nem pelos eventos");
  ok(JSON.stringify(await master(s + "/live")).includes("Espectro"), "mestre vê a criatura");
  await player(s + "/view?as=" + encodeURIComponent(live.me.userId), "GET", undefined, 403);

  // Movimento: casa desconhecida recusada com mensagem genérica; depois de clarear, caminho livre.
  await master(s + "/turn", "POST", { characterId: character.id }, 204);
  const mine = live.tokens.find((t) => t.characterId === character.id);
  const refused = await player(`${s}/tokens/${mine.id}/move`, "POST", { x: mine.x + 3, y: mine.y }, 400);
  check(refused.message ?? refused.title ?? refused.error ?? Object.values(refused).find((v) => typeof v === "string"), "Esse ponto não está disponível.");
  await master(s + "/fog/paint", "POST", { tool: "reveal", cells: [0, 1, 2, 3].map((i) => ({ x: mine.x + i, y: mine.y })) }, 204);
  await player(`${s}/tokens/${mine.id}/move`, "POST", { x: mine.x + 3, y: mine.y }, 204);

  // Corrida: pintura do mestre e luz do marcador ao mesmo tempo; nenhuma resposta 500 e estado coerente.
  const results = await Promise.all([
    master(s + "/fog/paint", "POST", { tool: "wall", cells: [{ x: 20, y: 7 }] }, null, { raw: true }),
    master(`${s}/tokens/${mine.id}/settings`, "POST", { light: 4, vision: null, perception: null, senses: null, hidden: false, dc: null, detectSense: null, detectRange: null }, null, { raw: true }),
    player(s + "/live", "GET", undefined, null, { raw: true }),
  ]);
  ok(results.every((r) => r.status < 500), "corrida sem erro interno: " + results.map((r) => r.status).join(","));
  live = await player(s + "/live");
  check(live.tokens.find((t) => t.id === mine.id).light, 4);

  // Configuração: só nesta sessão × campanha toda.
  const settings = { ...initial.settings, fogEnabled: false };
  await master(s + "/table-settings", "PUT", { settings, scope: "session" }, 204);
  check((await player(s + "/live")).fog.active, false);
  check((await master(path + "/table-settings")).inherited, true);
  await master(s + "/table-settings", "PUT", { settings: { ...initial.settings, torchRadius: 2 }, scope: "campaign" }, 204);
  const after = await master(s + "/table-settings");
  check([after.scope, after.settings.torchRadius, after.settings.fogEnabled], ["campaign", 2, true]);
  await master(s + "/table-settings", "PUT", { settings, scope: "everywhere" }, 400);

  // Preparação de mapa enviado com revisão + imagem mascarada para o jogador.
  const bytes = await readFile(new URL("./fixtures/avatar.png", import.meta.url));
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: "Salão", gridPixels: "32", scaleMeters: "1.5" })) form.append(k, v);
  form.append("file", new Blob([bytes], { type: "image/png" }), "salao.png");
  const map = await master(path + "/assets/maps", "POST", form);
  const layerUrl = `${path}/assets/layers?key=${encodeURIComponent(map.key)}`;
  const layer = await master(layerUrl);
  check(layer.revision, 0);
  const cells = layer.cells.map((row, y) => (y === 1 ? "#" + row.slice(1) : row));
  const saved = await master(layerUrl, "PUT", { fog: null, cells, lights: [], revealed: "", marks: [{ x: 2, y: 2, kind: "trap", label: "Fosso", dc: 10, sense: null, maxDistance: null }], revision: 0 });
  check(saved.revision, 1);
  await master(layerUrl, "PUT", { fog: null, cells, lights: [], revealed: "", marks: [], revision: 0 }, 409);
  await player(layerUrl, "GET", undefined, 403);
  await master(s + "/map", "POST", { mapKind: "tileset", mapKey: map.key }, 204);
  live = await player(s + "/live");
  ok(live.map.imageUrl.includes("?v="), "imagem do jogador é versionada pela exploração");
  ok(!JSON.stringify(live).includes("Fosso"), "marca oculta não chega ao jogador");
  const full = await master(map.imageUrl, "GET", undefined, 200, { raw: true });
  const playerImage = await player(live.map.imageUrl, "GET", undefined, 200, { raw: true });
  check(playerImage.headers.get("content-type"), "image/jpeg");
  ok(playerImage.headers.get("cache-control").includes("no-store"));
  const asPlayer = await master(`${map.imageUrl}?as=${encodeURIComponent(live.me.userId)}`, "GET", undefined, 200, { raw: true });
  ok(JSON.stringify(playerImage.data) !== JSON.stringify(full.data), "jogador não recebe a imagem completa");
  check(JSON.stringify(asPlayer.data), JSON.stringify(playerImage.data), "ver como recebe a mesma imagem do jogador");
  const view = await master(s + "/view?as=" + encodeURIComponent(live.me.userId));
  check(view.fog.explored, live.fog.explored);

  // Exploração continua na próxima sessão e o mestre pode recomeçar.
  await master(s + "/fog/paint", "POST", { tool: "reveal", cells: [{ x: 3, y: 3 }] }, 204);
  await master(s + "/end", "POST", undefined, 204);
  const next = await master(path + "/sessions", "POST", { title: "Volta", objective: "", mapKind: "tileset", mapKey: map.key });
  const n = `/api/sessions/${next.id}`;
  ok((await master(n + "/live")).fog.revealed !== "", "névoa revelada continua na sessão seguinte");
  await master(n + "/fog/reset", "POST", undefined, 204);
  check((await master(n + "/live")).fog.revealed, "");
  await player(n + "/fog/reset", "POST", undefined, 403);
  console.log(`table-fog: ${env.count()} verificações aprovadas`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  await env.stop();
}
