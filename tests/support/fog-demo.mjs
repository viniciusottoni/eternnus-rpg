// Ambiente manual para revisar a névoa no navegador (não faz parte da suíte). Encerre com Ctrl+C.
import { startEnvironment, password } from "./harness.mjs";
const env = await startEnvironment({ port: 5240 });
const systemId = "00000000-0000-4000-8000-000000000001";
const master = await env.verifiedClient("mestre.demo@example.test", "Mestre Demo");
const player = await env.verifiedClient("jogador.demo@example.test", "Ana");
const campaign = await master("/api/campaigns", "POST", { name: "Cripta escura", description: "Revisão visual da névoa", rpgSystemId: systemId });
const path = `/api/campaigns/${campaign.id}`;
await player("/api/campaigns/join", "POST", { code: (await master(path)).inviteCode });
const character = await player("/api/characters", "POST", { name: "Lira", archetype: "Batedora", level: 1, hp: 10, maxHp: 10, strength: 10, agility: 10, intellect: 10, notes: "", movement: 9 });
const session = await master(path + "/sessions", "POST", { title: "Descida", objective: "", mapKind: "tileset", mapKey: "crypt" });
const s = `/api/sessions/${session.id}`;
await player(s + "/join", "POST", { characterId: character.id }, 204);
await master(s + "/join", "POST", {}, 204);
const live = await player(s + "/live");
const mine = live.tokens.find((t) => t.characterId === character.id);
await master(`${s}/tokens/${mine.id}/settings`, "POST", { light: 3, vision: null, perception: null, senses: null, hidden: false, dc: null, detectSense: null, detectRange: null }, 204);
await master(s + "/tokens", "POST", { label: "Espectro", side: "enemy", x: 3, y: 8 });
await master(s + "/tokens", "POST", { label: "Guarda", side: "enemy", x: 10, y: 7 });
await master(s + "/tokens", "POST", { label: "Cultista", side: "enemy", x: 13, y: 9, hidden: true });
await master(s + "/fog/marks", "POST", { x: 9, y: 9, kind: "trap", label: "Fosso", dc: 30, sense: null, maxDistance: null }, 204);
// Alcance de ataque de 3 m só para a revisão (o modelo livre não tem o papel "reach").
env.sql(`UPDATE "Characters" SET "ReachMeters" = 3 WHERE "Id" = '${character.id}'`);
await master(s + "/turn", "POST", { characterId: character.id }, 204);
console.log(JSON.stringify({ origin: env.origin, campaignId: campaign.id, sessionId: session.id, password, master: "mestre.demo@example.test", player: "jogador.demo@example.test" }));
setInterval(() => {}, 1 << 30);
process.on("SIGINT", async () => { await env.stop(); process.exit(0); });
process.on("SIGTERM", async () => { await env.stop(); process.exit(0); });
