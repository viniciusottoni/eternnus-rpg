// Integração PostgreSQL: escopos, publicação, upload real, byte authorization e corrida selecionar/excluir.
import { readFile } from "node:fs/promises";
import { startEnvironment } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5214 });
const { check, ok } = env;
const systemId = "00000000-0000-4000-8000-000000000001";
try {
  const master = await env.verifiedClient("master.assets@example.test", "Mestre");
  const player = await env.verifiedClient("player.assets@example.test", "Jogador");
  const outsider = await env.verifiedClient("outsider.assets@example.test", "Visitante");
  const campaign = await master("/api/campaigns", "POST", { name: "Bibliotecas e mapas", description: "Teste", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  // Este roteiro cobre mapas sem névoa; table-fog.mjs cobre a imagem mascarada.
  await master(path + "/table-settings", "PUT", { settings: { fogEnabled: false, rememberExplored: true, pathMovement: true, alliesAlwaysVisible: true, torchRadius: 4, brazierRadius: 3, creatureLight: 0, playerLightMeters: 0, playerVisionMeters: 0 } });
  await player("/api/campaigns/join", "POST", { code: (await master(path)).inviteCode });
  const base = path + "/assets";
  // Textos antigos (ADR-063): não há mais criação; o mestre converte cada um em página.
  const legacy = (title, published) => env.sql(`INSERT INTO "CampaignLibraryEntry" ("Id","CampaignId","Title","Text","Kind","Published","Revision","UpdatedAt") VALUES (gen_random_uuid(),'${campaign.id}','${title}','Texto de ${title}','text',${published},1,now()) RETURNING "Id"`).split(/\s+/)[0];
  const draftId = legacy("Rascunho antigo", false), publishedId = legacy("Carta antiga", true);
  check((await player(base + "/library")).items.map((x) => x.title), ["Carta antiga"]);
  check((await master(base + "/library")).total, 2);
  await outsider(base + "/library", "GET", undefined, 404);
  await master(base + "/library", "POST", { title: "Novo", text: "Não", published: true }, 405);
  await player(`${base}/library/${publishedId}/convert`, "POST", { revision: 1 }, 403);
  await master(`${base}/library/${publishedId}/convert`, "POST", { revision: 7 }, 409);
  const converted = await master(`${base}/library/${publishedId}/convert`, "POST", { revision: 1 });
  await master(`${base}/library/${publishedId}/convert`, "POST", { revision: 2 }, 409);
  const page = await player(`${path}/workspace/pages/${converted.pageId}`);
  check([page.title, page.content, page.visibility, page.kind], ["Carta antiga", "Texto de Carta antiga", "table", "text"]);
  check((await player(base + "/library")).total, 0);
  const privatePage = await master(`${base}/library/${draftId}/convert`, "POST", { revision: 1 });
  await player(`${path}/workspace/pages/${privatePage.pageId}`, "GET", undefined, 404);
  check((await master(base + "/library")).total, 0);
  check(env.sql(`SELECT count(*) FROM "CampaignLibraryEntry" WHERE "CampaignId"='${campaign.id}' AND "ConvertedPageId" IS NOT NULL`).trim(), "2");
  // Importação por link: autoriza antes de qualquer rede e recusa destinos internos sem conectar (ADR-063).
  const linked = { name: "Link", folderId: null, gridPixels: 64, scaleMeters: 1.5, hasGrid: false };
  await player(base + "/maps/import", "POST", { ...linked, url: "https://example.com/a.png" }, 403);
  for (const url of ["https://127.0.0.1/a.png", "https://169.254.169.254/latest", "http://example.com/a.png", "https://localhost/a.png"])
    await master(base + "/maps/import", "POST", { ...linked, url }, 400);
  await player(`${path}/workspace/pages/${converted.pageId}/attachments/import`, "POST", { url: "https://example.com/a.png" }, 404);
  await master(`${path}/workspace/pages/${converted.pageId}/attachments/import`, "POST", { url: "https://[::1]/a.png" }, 400);
  check((await player(`/api/library?systemId=${systemId}`)).total, 0);
  check((await player("/api/library?systemId=none")).total, 0);
  const folder = await master(base + "/folders", "POST", { name: "Mundo", parentId: null });
  const child = await master(base + "/folders", "POST", { name: "Cidade", parentId: folder.id });
  const renamed = await master(`${base}/folders/${folder.id}`, "PUT", { name: "  Mundo antigo  " });
  check([renamed.id, renamed.name, renamed.parentId], [folder.id, "Mundo antigo", null]);
  await player(`${base}/folders/${folder.id}`, "PUT", { name: "Invasão" }, 403);
  await master(`${base}/folders/${folder.id}`, "PUT", { name: " " }, 400);
  await outsider(`${base}/folders/${folder.id}`, "PUT", { name: "Fora" }, 404);
  const bytes = await readFile(new URL("./fixtures/avatar.png", import.meta.url));
  async function upload(name, destination = base, destinationFolder = child.id) {
    const form = new FormData();
    for (const [key, value] of Object.entries({ name, folderId: destinationFolder, gridPixels: "32", scaleMeters: "2" })) form.append(key, value);
    form.append("file", new Blob([bytes], { type: "image/png" }), "mapa.png");
    return master(destination + "/maps", "POST", form);
  }
  const map = await upload("Cidade");
  check([map.gridPixels, map.scaleMeters, map.kind], [32, 2, "tileset"]);
  await player(map.imageUrl, "GET", undefined, 404);
  await master(`${base}/folders/${child.id}`, "DELETE", undefined, 409);
  const session = await master(path + "/sessions", "POST", { title: "Sessão", objective: "", mapKind: map.kind, mapKey: map.key });
  const image = await player(map.imageUrl, "GET", undefined, 200, { raw: true });
  check(image.headers.get("content-type"), "image/jpeg");
  ok(image.headers.get("cache-control").includes("no-store"));
  const live = await player(`/api/sessions/${session.id}/live`);
  check([live.map.key, live.map.gridPixels, live.map.scaleMeters], [map.key, 32, 2]);
  check(live.map.rows, ["SSSS", "....", "....", "...."]);
  const character = await player("/api/characters", "POST", { name: "Aventureiro", archetype: "Explorador", level: 1, hp: 10, maxHp: 10, strength: 10, agility: 10, intellect: 10, notes: "", movement: 3 });
  await player(`/api/sessions/${session.id}/join`, "POST", { characterId: character.id }, 204);
  await master(`/api/sessions/${session.id}/turn`, "POST", { characterId: character.id }, 204);
  const joined = await player(`/api/sessions/${session.id}/live`);
  const ownToken = joined.tokens.find(t => t.characterId === character.id);
  check([ownToken.x, ownToken.y], [0, 0]);
  await player(`/api/sessions/${session.id}/tokens/${ownToken.id}/move`, "POST", { x: 2, y: 0 }, 400);
  await player(`/api/sessions/${session.id}/tokens/${ownToken.id}/move`, "POST", { x: 1, y: 0 }, 204);
  await player(`/api/sessions/${session.id}/tokens/${ownToken.id}/move`, "POST", { x: 2, y: 0 }, 409);
  await master(`/api/sessions/${session.id}/tokens`, "POST", { label: "Criatura", side: "enemy", x: 3, y: 3 });
  await master(`/api/sessions/${session.id}/tokens/${ownToken.id}/move`, "POST", { x: 3, y: 3 }, 409);
  await master(`/api/sessions/${session.id}/tokens/${ownToken.id}/move`, "POST", { x: 4, y: 4 }, 400);
  await master(`${base}/maps/${map.id}`, "DELETE", undefined, 409);
  await master(`/api/sessions/${session.id}/map`, "POST", { mapKind: "cartographic", mapKey: "valley" }, 204);
  await player(map.imageUrl, "GET", undefined, 404);
  const raced = await upload("Corrida");
  const [selection, deletion] = await Promise.all([
    master(`/api/sessions/${session.id}/map`, "POST", { mapKind: raced.kind, mapKey: raced.key }, null, { raw: true }),
    master(`${base}/maps/${raced.id}`, "DELETE", undefined, null, { raw: true }),
  ]);
  ok((selection.status === 204 && deletion.status === 409) || (selection.status === 200 && deletion.status === 409) || (selection.status === 400 && deletion.status === 204), `Corrida serializada: ${selection.status}/${deletion.status}`);
  await master(`/api/sessions/${session.id}/end`, "POST", undefined, 204);
  await player(map.imageUrl, "GET", undefined, 404);
  await player(path + "/leave", "POST", undefined, 204);
  await master(path, "DELETE", undefined, 204);
  // One-shot nasce com a sessão única aberta; o preparo acontece com a mesa aberta e o mestre presente.
  const one = await master("/api/one-shots", "POST", { name: "Livre", description: "Teste de descarte", rpgSystemId: systemId });
  const onePath = `/api/campaigns/${one.campaignId}`, oneBase = onePath + "/assets";
  await master(onePath + "/sessions", "POST", { title: "Outra", objective: "", mapKind: "tileset", mapKey: "crypt" }, 409);
  const oneRoot = await master(oneBase + "/folders", "POST", { name: "Raiz", parentId: null });
  const oneChild = await master(oneBase + "/folders", "POST", { name: "Filha", parentId: oneRoot.id });
  await master(`/api/sessions/${one.sessionId}/heartbeat`, "POST", undefined, 204);
  const oneMap = await upload("Temporário da mesa livre", oneBase, oneChild.id);
  await master(`/api/sessions/${one.sessionId}/map`, "POST", { mapKind: oneMap.kind, mapKey: oneMap.key }, 204);
  // Sair da tela não apaga a one-shot (espera recuperável); encerrar apaga.
  await master(`/api/sessions/${one.sessionId}/leave`, "POST", undefined, 204);
  await master(onePath, "GET", undefined, 200);
  await master(`/api/sessions/${one.sessionId}/join`, "POST", {}, 204);
  await master(`/api/sessions/${one.sessionId}/end`, "POST", undefined, 204);
  await master(onePath, "GET", undefined, 404);
  check(env.sql(`SELECT count(*) FROM "CampaignMap" WHERE "CampaignId"='${one.campaignId}'`), "0");
  check(env.sql(`SELECT count(*) FROM "CampaignMapFolder" WHERE "CampaignId"='${one.campaignId}'`), "0");
  console.log(`Campaign assets: ${env.count()} verificações passaram.`);
} finally { await env.stop(); }
