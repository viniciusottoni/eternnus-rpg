/**
 * Condução independente do sistema com PostgreSQL real: convite até a mesa, modo livre e tático, rolagens privadas,
 * pedido de teste concorrente, espera recuperável da one-shot, conversão e arquivamento sob concorrência.
 */
import { startEnvironment, wait } from "./support/harness.mjs";
const env = await startEnvironment({ port: 5317 });
const { check, ok, sql } = env;
const free = "00000000-0000-4000-8000-000000000001";
try {
  const master = await env.verifiedClient("mestre.play@example.test", "Mestra");
  const other = await env.verifiedClient("outro.play@example.test", "Bruno");

  // Mestre cria a partida sem configurar ferramentas avançadas: nome, sistema e forma de jogar.
  const created = await master("/api/campaigns", "POST", { name: "Ventos", description: "", rpgSystemId: free, playMode: "free" });
  const detail = await master(`/api/campaigns/${created.id}`);
  const settings = await master(`/api/campaigns/${created.id}/table-settings`);
  check(settings.settings.playMode, "free", "forma escolhida na criação vira ajuste da campanha");

  // Usuário novo: convite → cadastro → verificação → convite guardado no servidor → entrar → personagem → mesa.
  const newbie = env.client();
  const user = await env.register(newbie, "novata.play@example.test", "Novata");
  await newbie(`/api/invites/${detail.inviteCode}`, "GET", undefined, 403);
  await newbie("/api/invites/pending", "POST", { code: detail.inviteCode }, 204);
  await env.confirm(newbie, user);
  check((await newbie("/api/invites/pending")).code, detail.inviteCode, "convite sobrevive à confirmação de e-mail");
  check((await newbie("/api/home")).pendingInvite, detail.inviteCode, "início oferece continuar o convite");
  const preview = await newbie(`/api/invites/${detail.inviteCode}`);
  check([preview.name, preview.member, preview.playMode], ["Ventos", false, "free"], "prévia do convite");
  ok(!JSON.stringify(preview).includes("@"), "prévia não expõe e-mail");
  await newbie("/api/campaigns/join", "POST", { code: detail.inviteCode });
  check((await newbie("/api/invites/pending")).code, null, "entrar limpa o convite guardado");
  await other("/api/campaigns/join", "POST", { code: detail.inviteCode });

  const session = await master(`/api/campaigns/${created.id}/sessions`, "POST", { title: "Abertura", objective: "Segredo", mapKind: "tileset", mapKey: "crypt" });
  const entry = await newbie(`/api/campaigns/${created.id}/table`);
  check(entry.characters.length, 0, "sem ficha compatível ainda");
  ok(entry.template?.name, "mesa indica o modelo da campanha para criar ficha");
  const hero = await newbie("/api/characters", "POST", { campaignId: created.id, name: "Íris", values: {} });
  await newbie(`/api/sessions/${session.id}/join`, "POST", { characterId: hero.id }, 204);
  const rival = await other("/api/characters", "POST", { campaignId: created.id, name: "Brás", values: {} });
  await other(`/api/sessions/${session.id}/join`, "POST", { characterId: rival.id }, 204);
  const live = await newbie(`/api/sessions/${session.id}/live`);
  check(live.play.mode, "free", "sessão fixa a forma de jogar");
  check(live.me.joined, true, "usuário novo chegou à mesa");

  // Modo livre não exige turno; rolagem às cegas e privada não vazam. Só o mestre define a visibilidade das rolagens dos jogadores.
  const rollBase = (await master(`/api/sessions/${session.id}/table-settings`)).settings;
  const playerRolls = (v) => master(`/api/sessions/${session.id}/table-settings`, "PUT", { settings: { ...rollBase, playerRollVisibility: v }, scope: "session" }, 204);
  await playerRolls("blind");
  await newbie(`/api/sessions/${session.id}/rolls`, "POST", { spec: { count: 1, sides: 20, modifier: 9 }, label: "Furtividade", visibility: "table" });
  await playerRolls("master");
  await newbie(`/api/sessions/${session.id}/rolls`, "POST", { formula: "1d20+4", label: "Intuição", visibility: "table" });
  await playerRolls("table");
  const mine = JSON.stringify(await newbie(`/api/sessions/${session.id}/live`));
  ok(!mine.includes("1d20+9"), "quem rola às cegas não recebe o resultado");
  ok(mine.includes("1d20+4"), "rolagem jogador+mestre chega ao autor");
  const others = JSON.stringify(await other(`/api/sessions/${session.id}/live`));
  ok(!others.includes("Furtividade") && !others.includes("Intuição"), "outro jogador não recebe rolagens privadas");
  const masters = JSON.stringify(await master(`/api/sessions/${session.id}/live`));
  ok(masters.includes("1d20+9") && masters.includes("1d20+4"), "mestre recebe as duas");

  // Pedido de teste: duas respostas simultâneas do mesmo personagem → uma vence.
  const req = await master(`/api/sessions/${session.id}/roll-requests`, "POST", { label: "Reflexos", spec: { count: 1, sides: 20 }, visibility: "table", target: 12, rule: "gte", characterIds: [hero.id, rival.id] });
  const answers = await Promise.all([1, 2].map(() => newbie(`/api/sessions/${session.id}/roll-requests/${req.id}/respond`, "POST", undefined, null, { raw: true })));
  check(answers.map((a) => a.status).sort(), [200, 409], "resposta duplicada concorrente é recusada");
  await master(`/api/sessions/${session.id}/roll-requests/${req.id}/cancel`, "POST", undefined, 204);
  await other(`/api/sessions/${session.id}/roll-requests/${req.id}/respond`, "POST", undefined, 409);

  // Tática na sessão: exige a vez de novo.
  const tactical = { ...settings.settings, playMode: "tactical", fogEnabled: false };
  await master(`/api/sessions/${session.id}/table-settings`, "PUT", { settings: tactical, scope: "session" }, 204);
  await newbie(`/api/sessions/${session.id}/actions`, "POST", { kind: "ataque", actionId: null, target: "" }, 409);
  await master(`/api/sessions/${session.id}/end`, "POST", undefined, 204);

  // Arquivar × iniciar concorrentes: nunca arquiva com sessão ativa.
  const race = await Promise.all([
    master(`/api/campaigns/${created.id}/archive`, "POST", undefined, null, { raw: true }),
    master(`/api/campaigns/${created.id}/sessions`, "POST", { title: "Corrida", objective: "", mapKind: "tileset", mapKey: "crypt" }, null, { raw: true }),
  ]);
  const archived = sql(`SELECT "ArchivedAt" IS NOT NULL FROM "Campaigns" WHERE "Id"='${created.id}'`) === "t";
  const active = sql(`SELECT count(*) FROM "Sessions" WHERE "CampaignId"='${created.id}' AND "EndedAt" IS NULL`);
  ok(!(archived && active !== "0"), "arquivada nunca fica com sessão ativa");
  check(race.filter((r) => r.status < 300).length >= 1, true, "uma das operações concorrentes vence");
  if (active !== "0") {
    const open = sql(`SELECT "Id" FROM "Sessions" WHERE "CampaignId"='${created.id}' AND "EndedAt" IS NULL`);
    await master(`/api/sessions/${open}/end`, "POST", undefined, 204);
    await master(`/api/campaigns/${created.id}/archive`, "POST", undefined, 204);
  }
  await master(`/api/campaigns/${created.id}/sessions`, "POST", { title: "Bloqueada", objective: "", mapKind: "tileset", mapKey: "crypt" }, 409);
  await master(`/api/campaigns/${created.id}/restore`, "POST", undefined, 204);

  // One-shot: desconexão breve do mestre não apaga; reconexão retoma; prazo vencido limpa.
  const shot = await master("/api/one-shots", "POST", { name: "Noite curta", description: "", rpgSystemId: free });
  const shotCode = (await master(`/api/campaigns/${shot.campaignId}`)).inviteCode;
  await other("/api/campaigns/join", "POST", { code: shotCode });
  await master(`/api/sessions/${shot.sessionId}/leave`, "POST", undefined, 204);
  sql(`UPDATE "Campaigns" SET "MasterLastSeenAt"=now()-interval '2 minutes' WHERE "Id"='${shot.campaignId}'`);
  await wait(11000);
  check(sql(`SELECT count(*) FROM "Campaigns" WHERE "Id"='${shot.campaignId}'`), "1", "desconexão breve não remove a one-shot");
  const waiting = await other(`/api/sessions/${shot.sessionId}/live`);
  check(waiting.play.masterAway, true, "jogador vê a espera");
  ok(waiting.play.recoverUntil, "prazo de recuperação informado");
  await master(`/api/sessions/${shot.sessionId}/join`, "POST", {}, 204);
  check((await other(`/api/sessions/${shot.sessionId}/live`)).play.masterAway, false, "reconexão retoma a mesa");

  // Conversão concorrente com nova entrada: quota do mestre e jogadores respeitadas; dados preservados.
  const converted = await master(`/api/campaigns/${shot.campaignId}/convert`, "POST");
  check([converted.kept, converted.removed], [1, 0], "jogador com vaga é mantido");
  check(sql(`SELECT "IsOneShot" FROM "Campaigns" WHERE "Id"='${shot.campaignId}'`), "f", "virou campanha persistente");
  check(sql(`SELECT count(*) FROM "Sessions" WHERE "CampaignId"='${shot.campaignId}' AND "EndedAt" IS NULL`), "1", "sessão preservada");
  await master(`/api/campaigns/${shot.campaignId}/convert`, "POST", undefined, 409);
  const extra = await master("/api/one-shots", "POST", { name: "Sem vaga", description: "", rpgSystemId: free });
  await master("/api/campaigns", "POST", { name: "Terceira", description: "", rpgSystemId: free });
  const pair = await Promise.all([
    master(`/api/campaigns/${extra.campaignId}/convert`, "POST", undefined, null, { raw: true }),
    master("/api/campaigns", "POST", { name: "Quarta", description: "", rpgSystemId: free }, null, { raw: true }),
  ]);
  ok(pair.every((r) => r.status === 409), "com três campanhas, nem conversão nem nova campanha passam");
  check((await master("/api/auth/limits")).activeCampaigns, 3, "quota de três campanhas preservada");

  const recovered = await master("/api/one-shots", "POST", { name: "Vence", description: "", rpgSystemId: free });
  sql(`UPDATE "Campaigns" SET "MasterLastSeenAt"=now()-interval '11 minutes' WHERE "Id"='${recovered.campaignId}'`);
  for (let i = 0; i < 60 && sql(`SELECT count(*) FROM "Campaigns" WHERE "Id"='${recovered.campaignId}'`) !== "0"; i++) await wait(250);
  check(sql(`SELECT count(*) FROM "Campaigns" WHERE "Id"='${recovered.campaignId}'`), "0", "após o prazo, a limpeza remove a mesa");

  console.log(`Table play PostgreSQL: ${env.count()} verificações passaram.`);
} finally { await env.stop(); }
