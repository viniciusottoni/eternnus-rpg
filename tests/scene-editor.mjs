// Integração PostgreSQL do editor de cenas: preparação privada sem apresentar, separação preparação × apresentação,
// aplicação explícita com revisões concorrentes, preparação do mapa com a camada na mesa, imagem sem grade,
// preferência de interface e isolamento entre mestre e jogador.
import { readFile } from "node:fs/promises";
import { startEnvironment } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5243 });
const { check, ok } = env;
const systemId = "00000000-0000-4000-8000-000000000001";
try {
  const master = await env.verifiedClient("mestre.cenas@example.test", "Mestre");
  const player = await env.verifiedClient("jogador.cenas@example.test", "Ana");
  const campaign = await master("/api/campaigns", "POST", { name: "Travessia", description: "Cenas", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  await player("/api/campaigns/join", "POST", { code: (await master(path)).inviteCode });
  const character = await player("/api/characters", "POST", { name: "Lira", archetype: "Batedora", level: 1, hp: 10, maxHp: 10, strength: 10, agility: 10, intellect: 10, notes: "", movement: 9 });

  // Preferência de interface: validada, lembrada na conta e sem efeito sobre regras.
  check((await master("/api/auth/me")).interfaceMode, null);
  await master("/api/auth/preferences", "PUT", { interfaceMode: "advanced" }, 400);
  await master("/api/auth/preferences", "PUT", { interfaceMode: "complete" }, 204);
  check((await master("/api/auth/me")).interfaceMode, "complete");

  // Sessão aberta num cenário sem grade; a cena é preparada em particular, sem apresentar.
  const session = await master(path + "/sessions", "POST", { title: "Chegada", objective: "", mapKind: "cartographic", mapKey: "valley" });
  const s = `/api/sessions/${session.id}`;
  await player(s + "/join", "POST", { characterId: character.id }, 204);
  const layer0 = await master(`${path}/assets/layers?key=crypt`);
  const free = [];
  for (let y = 0; y < layer0.height && free.length < 6; y++) for (let x = 0; x < layer0.width && free.length < 6; x++) if (layer0.cells[y][x] === "." && layer0.rows[y][x] === ".") free.push({ x, y });
  const prepared = [{ label: "Sentinela", side: "enemy", x: free[0].x, y: free[0].y, hidden: true }, { characterId: character.id, x: free[1].x, y: free[1].y }];
  const created = await master(path + "/scenes", "POST", { name: "Ponte", kind: "map", mapKey: "crypt", sharedText: "O vento sopra.", privateNotes: "Emboscada secreta", visionMode: null, order: 0, revision: 0, prepared });
  await player(`${path}/scenes/${created.id}`, "GET", undefined, 403);
  let live = await player(s + "/live");
  check([live.map.key, live.play.scene], ["valley", null]);
  ok(!JSON.stringify(live).includes("Sentinela") && !JSON.stringify(live).includes("Emboscada"), "preparação privada não chega ao jogador");
  const detail = await master(`${path}/scenes/${created.id}`);
  check([detail.prepared.length, detail.live.current], [2, false]);

  // Apresentar: jogador recebe nome e texto; criatura oculta e notas continuam privadas.
  await master(s + "/scene", "POST", { sceneId: created.id, restart: false }, 204);
  live = await player(s + "/live");
  check([live.play.scene.name, live.play.scene.sharedText, live.map.key], ["Ponte", "O vento sopra.", "crypt"]);
  ok(!JSON.stringify(live).includes("Sentinela") && !JSON.stringify(live).includes("Emboscada"), "oculto e notas privadas fora do payload do jogador");
  check(live.tokens.find((t) => t.characterId === character.id)?.x, free[1].x);

  // Salvar a preparação não muda a mesa; aplicar é explícito e recusa revisão obsoleta, também em corrida.
  const rev = (await master(`${path}/scenes/${created.id}`)).revision;
  await master(`${path}/scenes/${created.id}`, "PUT", { name: "Ponte", kind: "map", mapKey: "crypt", sharedText: "A ponte range.", privateNotes: "Emboscada secreta", visionMode: null, order: 0, revision: rev });
  check((await player(s + "/live")).play.scene.sharedText, "O vento sopra.");
  check((await master(s + "/live")).play.scene.pending.text, true);
  await master(s + "/scene/apply", "POST", { sceneId: created.id, text: true, vision: false, layer: false, sceneRevision: rev }, 409);
  await player(s + "/scene/apply", "POST", { sceneId: created.id, text: true, vision: false, layer: false, sceneRevision: rev + 1 }, 403);
  const race = await Promise.all([
    master(`${path}/scenes/${created.id}`, "PUT", { name: "Ponte", kind: "map", mapKey: "crypt", sharedText: "A ponte cai.", privateNotes: "", visionMode: null, order: 0, revision: rev + 1 }, null, { raw: true }),
    master(s + "/scene/apply", "POST", { sceneId: created.id, text: true, vision: false, layer: false, sceneRevision: rev + 1 }, null, { raw: true }),
  ]);
  ok(race.every((r) => r.status < 500), "corrida edição × aplicar sem erro interno: " + race.map((r) => r.status).join(","));
  const shown = (await player(s + "/live")).play.scene.sharedText;
  ok(["A ponte range.", "O vento sopra."].includes(shown), "a mesa nunca recebe texto que não foi aplicado: " + shown);
  const before = (await player(s + "/live")).tokens.find((t) => t.characterId === character.id);
  const now = await master(`${path}/scenes/${created.id}`);
  await master(s + "/scene/apply", "POST", { sceneId: created.id, text: true, vision: false, layer: false, sceneRevision: now.revision });
  live = await player(s + "/live");
  check(live.play.scene.sharedText, "A ponte cai.");
  check([live.tokens.find((t) => t.characterId === character.id).x, live.tokens.find((t) => t.characterId === character.id).y], [before.x, before.y]);

  // Recolocar marcadores é opcional; em corrida com um movimento não gera erro interno nem duplica marcadores.
  const arranged = await master(`${path}/scenes/${created.id}`);
  const mover = (await master(s + "/live")).tokens.find((t) => t.characterId === character.id);
  const placeRace = await Promise.all([
    master(s + "/scene/apply", "POST", { sceneId: created.id, text: false, vision: false, layer: false, tokens: true, sceneRevision: arranged.revision }, null, { raw: true }),
    master(s + `/tokens/${mover.id}/move`, "POST", { x: free[4].x, y: free[4].y }, null, { raw: true }),
  ]);
  ok(placeRace.every((r) => r.status < 500), "corrida recolocar × mover sem erro interno: " + placeRace.map((r) => r.status).join(","));
  check((await master(s + "/live")).tokens.filter((t) => t.characterId === character.id).length, 1);
  await master(s + "/scene/apply", "POST", { sceneId: created.id, text: false, vision: false, layer: false, tokens: true, sceneRevision: arranged.revision });
  live = await master(s + "/live");
  const back = live.tokens.find((t) => t.characterId === character.id);
  check([back.x, back.y, live.tokens.filter((t) => t.label === "Sentinela").length], [free[1].x, free[1].y, 1]);
  await master(s + "/scene/apply", "POST", { sceneId: created.id, text: false, vision: false, layer: false, tokens: false, sceneRevision: arranged.revision }, 400);

  // Preparação do mapa com a camada na mesa: fica pendente; duas gravações com a mesma versão → uma recusada.
  const url = `${path}/assets/layers?key=crypt&scene=${created.id}`;
  const prep = await master(url);
  check(prep.inUse, true);
  const wallAt = (c) => prep.cells.map((row, y) => (y === c.y ? row.slice(0, c.x) + "#" + row.slice(c.x + 1) : row));
  const body = (cells) => ({ fog: prep.fog, cells, lights: prep.lights.map((l) => ({ x: l.x, y: l.y, radius: l.radius })), revealed: prep.revealed, marks: [], revision: prep.revision, prepVersion: prep.prepVersion });
  // Duas edições reais e diferentes com a mesma versão lida: exatamente uma vence (sem perda silenciosa).
  const saves = await Promise.all([master(url, "PUT", body(wallAt(free[2])), null, { raw: true }), master(url, "PUT", body(wallAt(free[3])), null, { raw: true })]);
  const statuses = saves.map((r) => r.status).sort();
  ok(statuses[0] === 200 && statuses[1] === 409, "gravações concorrentes da preparação: " + statuses.join(","));
  const won = saves[0].status === 200 ? free[2] : free[3];
  const masterLive = await master(s + "/live");
  ok(masterLive.fog.cells[won.y][won.x] !== "#" || !masterLive.play.scene.pending.layer, "preparação salva não altera a mesa sem aplicar");
  if (masterLive.play.scene.pending.layer) {
    const pending = await master(url);
    await master(s + "/scene/apply", "POST", { sceneId: created.id, text: false, vision: false, layer: true, sceneRevision: (await master(`${path}/scenes/${created.id}`)).revision, prepVersion: pending.prepVersion });
    check((await master(s + "/live")).fog.cells[won.y][won.x], "#");
  }
  await master(url, "PUT", { ...body(prep.cells), prepVersion: "0000000000000000" }, 409);

  // Imagem sem grade enviada pelo mestre vira cena de imagem; só chega ao jogador enquanto apresentada.
  const bytes = await readFile(new URL("./fixtures/avatar.png", import.meta.url));
  const form = new FormData();
  for (const [k, v] of Object.entries({ name: "Retrato", gridPixels: "32", scaleMeters: "1.5", hasGrid: "false" })) form.append(k, v);
  form.append("file", new Blob([bytes], { type: "image/png" }), "retrato.png");
  const image = await master(path + "/assets/maps", "POST", form);
  check([image.hasGrid, image.kind], [false, "cartographic"]);
  await master(path + "/scenes", "POST", { name: "Mapa inválido", kind: "map", mapKey: image.key, revision: 0 }, 400);
  const portrait = await master(path + "/scenes", "POST", { name: "Audiência", kind: "image", mapKey: image.key, sharedText: "A rainha observa.", revision: 0 });
  await player(`${path}/assets/maps/${image.id}/image`, "GET", undefined, 404, { raw: true });
  await master(s + "/scene", "POST", { sceneId: portrait.id, restart: false }, 204);
  live = await player(s + "/live");
  check([live.map.kind, live.map.rows.length], ["cartographic", 0]);
  const shownImage = await player(`${path}/assets/maps/${image.id}/image`, "GET", undefined, 200, { raw: true });
  check(shownImage.status, 200);

  // Retomar a ponte: posições e estado salvos voltam; improvisar guarda a cena e libera "Salvar como cena".
  await master(s + "/scene", "POST", { sceneId: created.id, restart: false }, 204);
  check((await player(s + "/live")).tokens.find((t) => t.characterId === character.id).x, before.x);
  await master(s + "/map", "POST", { mapKind: "cartographic", mapKey: "valley" }, 204);
  check((await player(s + "/live")).play.scene, null);
  const improvised = await master(s + "/scene/save-as", "POST", { name: "Vale improvisado", sharedText: "" });
  ok(!!improvised.id, "cenário improvisado salvo como cena");
  await master(`${path}/scenes/${improvised.id}`, "DELETE", undefined, 409);
  await master(`${path}/scenes/${portrait.id}`, "DELETE", undefined, 204);
  console.log(`scene-editor: ${env.count()} verificações PostgreSQL`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  await env.stop();
}
