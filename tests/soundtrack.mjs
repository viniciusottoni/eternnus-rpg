// Integração PostgreSQL: catálogo de músicas do servidor (Admin) e trilha da sessão — autorização, validação de upload,
// quotas, auditoria, bytes com HTTP Range, comandos concorrentes, consulta ao vivo, entrada tardia, exclusão em uso e encerramento.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { startEnvironment, wait } from "./support/harness.mjs";

const env = await startEnvironment({ port: 5216 });
const { check, ok } = env;
const systemId = "00000000-0000-4000-8000-000000000001";
const official = await readFile(new URL("../apps/Eternnus.Web/wwwroot/assets/audio/the-blade-and-the-serpent.v1.mp3", import.meta.url));
const png = await readFile(new URL("./fixtures/avatar.png", import.meta.url));

/** MP3 sintético válido: quadros MPEG-1 Layer III de 417 bytes (128 kbps, 44,1 kHz). */
function mp3(frames = 120) {
  const out = Buffer.alloc(frames * 417);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0x64], i * 417);
  return out;
}
function form(bytes, name, title) {
  const f = new FormData();
  if (title) f.append("title", title);
  f.append("file", new Blob([bytes], { type: "audio/mpeg" }), name);
  return f;
}
async function raw(client, path, headers = {}) {
  const response = await fetch(env.origin + path, { headers: { Cookie: client.cookieHeader(), ...headers } });
  return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
}
const audioFiles = async () => (await readdir(join(env.temp, "music"))).filter((f) => f.endsWith(".audio"));

try {
  const admin = await env.verifiedClient("admin.music@example.test", "Admin");
  env.sql(`UPDATE "AspNetUsers" SET "Role"='admin' WHERE "Email"='admin.music@example.test'`);
  await env.authenticateMfa(admin, "admin.music@example.test");
  const master = await env.verifiedClient("master.music@example.test", "Mestre");
  const player = await env.verifiedClient("player.music@example.test", "Jogadora");
  const late = await env.verifiedClient("late.music@example.test", "Atrasado");
  const outsider = await env.verifiedClient("outsider.music@example.test", "Visitante");
  const catalog = "/api/admin/music";

  // ---------- Catálogo: somente Admin gerencia ----------
  check((await admin(catalog)).total, 0);
  check((await master("/api/music")).total, 0);
  for (const client of [master, player, outsider]) {
    await client(catalog, "GET", undefined, 403);
    await client(catalog, "POST", form(mp3(), "x.mp3"), 403);
  }
  await admin(catalog, "POST", form(png, "imagem-renomeada.mp3"), 415);
  await admin(catalog, "POST", form(Buffer.from("MZ\x90\0nada de audio aqui".repeat(50)), "programa.mp3"), 415);
  // Acima do limite, o servidor recusa com 413 ou encerra a conexão antes de ler o corpo inteiro.
  try {
    check((await admin(catalog, "POST", form(Buffer.alloc(21 * 1024 * 1024, 1), "grande.mp3"), null, { raw: true })).status, 413);
  } catch (error) {
    ok(/ECONNRESET|fetch failed|EPIPE/.test(String(error.cause?.code || error.message)), `upload excessivo recusado: ${error.message}`);
  }
  const extra = new FormData();
  extra.append("campaignId", "outra");
  extra.append("file", new Blob([mp3()]), "a.mp3");
  await admin(catalog, "POST", extra, 400);

  const theme = await admin(catalog, "POST", form(official, "the-blade-and-the-serpent.mp3", "Tema de Eternnus"));
  check([theme.title, theme.contentType, theme.format], ["Tema de Eternnus", "audio/mpeg", "MP3"]);
  ok(theme.durationMs > 60000, `duração calculada: ${theme.durationMs}`);
  ok(!JSON.stringify(theme).includes(env.temp) && !("storageKey" in theme), "sem caminho físico ou chave interna");
  await admin(catalog, "POST", form(official, "copia.mp3", "Cópia"), 409);
  const tavern = await admin(catalog, "POST", form(mp3(), "taverna_alegre.mp3"));
  check(tavern.title, "taverna alegre");
  const stored = await audioFiles();
  check(stored.length, 2);
  ok(stored.every((f) => /^[0-9a-f]{32}\.audio$/.test(f)), "nomes opacos no armazenamento");
  check(env.sql(`SELECT count(*) FROM "Audit" WHERE "Action"='music.upload'`), "2");

  // Busca para mestres: só metadados de apresentação.
  const found = await master("/api/music?search=TEMA");
  check([found.total, found.items[0].id], [1, theme.id]);
  check(Object.keys(found.items[0]).sort(), ["durationMs", "format", "id", "title"]);
  check((await master("/api/music?page=2147483647")).items.length, 0);
  const renamed = await admin(`${catalog}/${tavern.id}`, "PUT", { title: "Taverna", revision: tavern.revision });
  await admin(`${catalog}/${tavern.id}`, "PUT", { title: "Obsoleto", revision: tavern.revision }, 409);
  await master(`${catalog}/${tavern.id}`, "PUT", { title: "Mestre", revision: renamed.revision }, 403);
  await master(`${catalog}/${tavern.id}`, "DELETE", undefined, 403);

  // Prévia do Admin: bytes com Range; ninguém mais usa essa rota.
  const preview = await raw(admin, theme.audioUrl, { Range: "bytes=0-99" });
  check(preview.status, 206);
  check(preview.headers.get("content-range"), `bytes 0-99/${official.length}`);
  ok(preview.body.equals(official.subarray(0, 100)), "faixa intacta no Range");
  check((await raw(master, theme.audioUrl)).status, 403);

  // ---------- Sessão ----------
  const campaign = await master("/api/campaigns", "POST", { name: "Trilha", description: "Teste", rpgSystemId: systemId });
  const path = `/api/campaigns/${campaign.id}`;
  const invite = (await master(path)).inviteCode;
  await player("/api/campaigns/join", "POST", { code: invite });
  await late("/api/campaigns/join", "POST", { code: invite });
  const character = await player("/api/characters", "POST", { name: "Lira", archetype: "Barda", level: 1, hp: 10, maxHp: 10, strength: 10, agility: 10, intellect: 10, notes: "", movement: 3 });
  const lateCharacter = await late("/api/characters", "POST", { name: "Tardio", archetype: "Guerreiro", level: 1, hp: 10, maxHp: 10, strength: 10, agility: 10, intellect: 10, notes: "", movement: 3 });
  const session = await master(`${path}/sessions`, "POST", { title: "Sessão musical", objective: "", mapKind: "tileset", mapKey: "crypt" });
  const s = `/api/sessions/${session.id}`;
  await master(`${s}/join`, "POST", {}, 204);
  await player(`${s}/join`, "POST", { characterId: character.id }, 204);
  const audioUrl = `${s}/music/${theme.id}/audio`;
  check((await raw(player, audioUrl)).status, 404);

  let live = await player(`${s}/live`);
  check([live.music.trackId, live.music.version], [null, 0]);
  await player(`${s}/music`, "POST", { action: "select", version: 0, trackId: theme.id }, 403);
  await outsider(`${s}/music`, "POST", { action: "select", version: 0, trackId: theme.id }, 404);
  await admin(`${s}/music`, "POST", { action: "select", version: 0, trackId: theme.id }, 404);
  await master(`${s}/music`, "POST", { action: "dançar", version: 0 }, 400);
  await master(`${s}/music`, "POST", { action: "play", version: 0 }, 409);
  await master(`${s}/music`, "POST", { action: "select", version: 0, trackId: "00000000-0000-4000-8000-0000000000aa" }, 404);

  // O jogador espera na consulta ao vivo; o comando do mestre o acorda antes do prazo longo.
  const waiting = (async () => {
    const started = Date.now();
    const next = await player(`${s}/live?after=${live.revision}`);
    return { next, elapsed: Date.now() - started };
  })();
  await wait(300);
  const selected = await master(`${s}/music`, "POST", { action: "select", version: 0, trackId: theme.id, autoplay: true });
  check([selected.music.trackId, selected.music.playing, selected.music.version, selected.music.audioUrl], [theme.id, true, 1, audioUrl]);
  const woke = await waiting;
  ok(woke.elapsed < 5000, `consulta ao vivo acordou em ${woke.elapsed} ms`);
  check([woke.next.music.trackId, woke.next.music.version], [theme.id, 1]);
  ok(!woke.next.events.some((e) => e.kind === "music"), "eventos da trilha ficam no histórico do mestre");

  // Bytes para o jogador na mesa: tipo validado, Range, sem cache.
  const full = await raw(player, audioUrl);
  check(full.status, 200);
  check(full.headers.get("content-type"), "audio/mpeg");
  check(full.headers.get("accept-ranges"), "bytes");
  ok(full.headers.get("cache-control").includes("no-store"), "no-store");
  check(full.headers.get("x-content-type-options"), "nosniff");
  ok(full.body.equals(official), "corpo completo idêntico");
  const middle = await raw(player, audioUrl, { Range: "bytes=1000-1999" });
  check([middle.status, middle.body.length], [206, 1000]);
  ok(middle.body.equals(official.subarray(1000, 2000)), "trecho do meio");
  const suffix = await raw(player, audioUrl, { Range: "bytes=-500" });
  ok(suffix.status === 206 && suffix.body.equals(official.subarray(official.length - 500)), "sufixo");
  check((await raw(player, audioUrl, { Range: `bytes=${official.length + 10}-` })).status, 416);
  check((await raw(player, `${s}/music/${tavern.id}/audio`)).status, 404);
  check((await raw(outsider, audioUrl)).status, 404);
  check((await raw(late, audioUrl)).status, 404);

  // Comandos concorrentes com a mesma versão: um vence, o outro recebe 409; o estado fica coerente.
  const [first, second] = await Promise.all([
    master(`${s}/music`, "POST", { action: "pause", version: 1 }, null, { raw: true }),
    master(`${s}/music`, "POST", { action: "seek", version: 1, positionMs: 30000 }, null, { raw: true }),
  ]);
  check([first.status, second.status].sort(), [200, 409]);
  live = await master(`${s}/live`);
  check(live.music.version, 2);

  // Pausa, busca e retomada; entrada tardia acompanha a referência do servidor.
  if (live.music.playing) await master(`${s}/music`, "POST", { action: "pause", version: live.music.version });
  live = await master(`${s}/live`);
  check(live.music.playing, false);
  await master(`${s}/music`, "POST", { action: "seek", version: live.music.version, positionMs: 60000 });
  live = await master(`${s}/live`);
  check([live.music.positionMs, live.music.playing], [60000, false]);
  const played = await master(`${s}/music`, "POST", { action: "play", version: live.music.version });
  check([played.music.positionMs, played.music.playing], [60000, true]);
  await wait(1500);
  await late(`${s}/join`, "POST", { characterId: lateCharacter.id }, 204);
  const joined = await late(`${s}/live`);
  const expected = joined.music.positionMs + (Date.parse(joined.serverTime) - Date.parse(joined.music.referenceAt));
  ok(expected >= 61400 && expected < 64000, `entrada tardia calcula ${expected} ms`);
  check((await raw(late, audioUrl, { Range: "bytes=0-9" })).status, 206);
  const looped = await master(`${s}/music`, "POST", { action: "loop", version: joined.music.version, loop: true });
  check(looped.music.loop, true);
  await master(`${s}/music`, "POST", { action: "seek", version: looped.music.version, positionMs: -1 }, 400);

  // Excluir a faixa em uso é recusado; seleção na mesa × exclusão no catálogo ficam serializadas.
  await admin(`${catalog}/${theme.id}`, "DELETE", undefined, 409);
  check((await admin(catalog)).items.find((t) => t.id === theme.id).inUse, true);
  const raced = await admin(catalog, "POST", form(mp3(200), "corrida.mp3"));
  const before = (await master(`${s}/live`)).music.version;
  const [selection, deletion] = await Promise.all([
    master(`${s}/music`, "POST", { action: "select", version: before, trackId: raced.id }, null, { raw: true }),
    admin(`${catalog}/${raced.id}`, "DELETE", undefined, null, { raw: true }),
  ]);
  ok((selection.status === 200 && deletion.status === 409) || (selection.status === 404 && deletion.status === 204), `corrida serializada: ${selection.status}/${deletion.status}`);
  live = await master(`${s}/live`);
  ok(live.music.trackId === theme.id || live.music.trackId === raced.id, "trilha aponta para faixa existente");
  if (live.music.trackId === raced.id) check((await raw(player, `${s}/music/${raced.id}/audio`, { Range: "bytes=0-9" })).status, 206);

  await master(`${s}/music`, "POST", { action: "stop", version: live.music.version });
  live = await player(`${s}/live`);
  check([live.music.trackId, live.music.audioUrl], [null, null]);
  check((await raw(player, audioUrl)).status, 404);
  await admin(`${catalog}/${theme.id}`, "DELETE", undefined, 204);
  if (selection.status === 200) await admin(`${catalog}/${raced.id}`, "DELETE", undefined, 204);
  check((await audioFiles()).length, 1);
  check(env.sql(`SELECT count(*) FROM "Audit" WHERE "Action"='music.delete'`), "2");

  // Encerramento: a trilha para, os bytes deixam de ser entregues e o estado persiste no banco.
  const last = await master(`${s}/music`, "POST", { action: "select", version: live.music.version, trackId: tavern.id });
  check(env.sql(`SELECT "MusicTrackId" FROM "Sessions" WHERE "Id"='${session.id}'`), tavern.id);
  check(env.sql(`SELECT "MusicPlaying"::text FROM "Sessions" WHERE "Id"='${session.id}'`), "true");
  check((await raw(player, `${s}/music/${tavern.id}/audio`, { Range: "bytes=0-9" })).status, 206);
  await master(`${s}/end`, "POST", undefined, 204);
  live = await player(`${s}/live`);
  ok(live.session.endedAt && live.music.trackId === null && live.music.version > last.music.version, "encerrada sem trilha");
  check((await raw(player, `${s}/music/${tavern.id}/audio`)).status, 404);
  await master(`${s}/music`, "POST", { action: "play", version: live.music.version }, 409);

  // Quota do catálogo: registros semeados no banco até o teto; o próximo envio é recusado.
  const existing = (await admin(catalog)).total;
  env.sql(`INSERT INTO "MusicTracks" ("Id","Title","ContentType","SizeBytes","DurationMs","Sha256","StorageKey","UploadedById","CreatedAt","Revision") SELECT gen_random_uuid(), 'Semeada ' || g, 'audio/mpeg', 1000, NULL, md5('s' || g), md5(random()::text || g), 'seed', now(), 1 FROM generate_series(1, ${200 - existing}) g`);
  await admin(catalog, "POST", form(mp3(77), "excesso.mp3"), 409);
  check((await admin(catalog)).usage.tracks, 200);

  // Catálogo é global: excluir a campanha não remove faixas.
  await player(`${path}/leave`, "POST", undefined, 204);
  await late(`${path}/leave`, "POST", undefined, 204);
  await master(path, "DELETE", undefined, 204);
  check(env.sql(`SELECT count(*) FROM "MusicTracks" WHERE "Id"='${tavern.id}'`), "1");
  console.log(`soundtrack.mjs: ${env.count()} verificações aprovadas.`);
} catch (error) {
  console.error(env.logs().slice(-4000));
  throw error;
} finally {
  await env.stop();
}
