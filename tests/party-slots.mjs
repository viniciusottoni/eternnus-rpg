// Integração PostgreSQL dos personagens reservados e do ensaio (ADR-110/111): mestre sozinho (sem jogadores) cria
// reservados, salva a cena com os tokens deles e reabre; a prévia do ensaio aceita tokens de ensaio, perfis e observador
// sintético; tokens de ensaio são recusados ao salvar; vincular a ficha de um jogador mantém as posições.
import { startEnvironment } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5293 });
const { check, ok } = env;
const systemId = "00000000-0000-4000-8000-000000000001";
try {
  const master = await env.verifiedClient("mestre.reservados@example.test", "Mestre");
  const campaign = await master("/api/campaigns", "POST", { name: "Reservados", description: "", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  const slots = `${path}/party-slots`;

  // Sem jogadores nem fichas: três reservados (genérico + arquétipos), listados em ordem.
  check((await master(slots)).items.length, 0);
  const a = await master(slots, "POST", { name: "Personagem 1" });
  const b = await master(slots, "POST", { name: "Guerreiro", archetype: "warrior" });
  const c = await master(slots, "POST", { name: "Maga", archetype: "mage" });
  check([a.archetype, b.archetype, c.archetype], [null, "warrior", "mage"]);
  check((await master(slots)).items.map((s) => s.name), ["Personagem 1", "Guerreiro", "Maga"]);

  // Cena com os três tokens reservados (o editor manda só o vínculo; nome e lado vêm do reservado).
  const layer = await master(`${path}/assets/layers?key=crypt`);
  const free = [];
  for (let y = 0; y < layer.height && free.length < 6; y++) for (let x = 0; x < layer.width && free.length < 6; x++) if (layer.cells[y][x] === "." && layer.rows[y][x] === ".") free.push({ x, y });
  const prepared = [a, b, c].map((s, i) => ({ slotId: s.id, label: s.name, side: "ally", x: free[i].x, y: free[i].y }));
  const scene = await master(`${path}/scenes`, "POST", { name: "Cripta", kind: "map", mapKey: "crypt", sharedText: "", privateNotes: "", visionMode: "character", order: 0, revision: 0, prepared });
  const reopened = await master(`${path}/scenes/${scene.id}`);
  check(reopened.prepared.map((t) => [t.slotId, t.x, t.y]), prepared.map((t) => [t.slotId, t.x, t.y]));
  ok(Array.isArray(reopened.slots) && reopened.slots.length === 3, "a cena traz a lista de reservados");

  // Token de ensaio nunca é salvo.
  await master(`${path}/scenes/${scene.id}`, "PUT", { name: "Cripta", kind: "map", mapKey: "crypt", sharedText: "", privateNotes: "", visionMode: "character", order: 0, revision: reopened.revision,
    prepared: [...prepared, { label: "Ensaio 1", side: "ally", x: free[3].x, y: free[3].y, rehearsal: true }] }, 400);

  // Ensaio: prévia com reservados + token de ensaio, perfil "Carregando uma fonte de luz" e observador sintético.
  const tokens = [...prepared, { label: "Ensaio 1", side: "ally", x: free[3].x, y: free[3].y, rehearsal: true }];
  const view = await master(`${path}/prep/preview-view`, "POST", { mapKey: "crypt", sceneId: scene.id, visionMode: "character", tokens, profiles: [{ token: 3, lightMeters: 12 }], viewerToken: 3 });
  ok(view.active === true, "névoa ativa na prévia do ensaio");
  ok(view.shown.includes(3), "o observador sintético aparece no resultado");
  const dark = await master(`${path}/prep/preview-view`, "POST", { mapKey: "crypt", sceneId: scene.id, visionMode: "character", tokens, profiles: [], viewerToken: 3 });
  ok(JSON.stringify(dark.visible) !== JSON.stringify(view.visible) || JSON.stringify(dark.explored) !== JSON.stringify(view.explored), "o perfil de luz muda o que o observador vê");

  // Renomear e excluir com contagem de cenas; duplicar respeita o limite.
  const renamed = await master(`${slots}/${a.id}`, "PUT", { name: "Ladino", archetype: "rogue", revision: a.revision });
  check([renamed.name, renamed.archetype], ["Ladino", "rogue"]);
  const copy = await master(`${slots}/${c.id}/duplicate`, "POST", {});
  ok(copy.id !== c.id && copy.name.length > 0, "duplicar cria outro reservado");
  await master(`${slots}/${copy.id}`, "DELETE", undefined, 204);

  // Jogador entra depois; vincular a ficha mantém a posição do token na cena.
  const player = await env.verifiedClient("jogador.reservados@example.test", "Ana");
  await player("/api/campaigns/join", "POST", { code: (await master(path)).inviteCode });
  const hero = await player("/api/characters", "POST", { campaignId: campaign.id, name: "Lira" });
  const list = await master(slots);
  ok(list.characters.some((x) => x.id === hero.id), "a ficha do jogador aparece para vincular");
  const preview = await master(`${slots}/${b.id}/bind-preview`, "POST", { characterId: hero.id });
  check(preview.conflicts.length, 0);
  const fresh = list.items.find((s) => s.id === b.id);
  const bound = await master(`${slots}/${b.id}/bind`, "POST", { characterId: hero.id, revision: fresh.revision, keepImage: true, resolve: null });
  check(bound.characterId, hero.id);
  const after = await master(`${path}/scenes/${scene.id}`);
  const heroToken = after.prepared.find((t) => t.characterId === hero.id);
  check([heroToken?.x, heroToken?.y], [free[1].x, free[1].y]);
  check(after.prepared.length, 3);
  // Outro reservado não recebe a mesma ficha.
  const other = (await master(slots)).items.find((s) => s.id === c.id);
  await master(`${slots}/${c.id}/bind`, "POST", { characterId: hero.id, revision: other.revision, keepImage: true, resolve: null }, 409);
  // Jogador não acessa os reservados.
  await player(slots, "GET", undefined, 403);
  console.log(`party-slots: ${env.count()} verificações PostgreSQL`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  await env.stop();
}
