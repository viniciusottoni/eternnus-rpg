import { startEnvironment } from "./support/harness.mjs";
import http from "node:http";
import { randomBytes } from "node:crypto";
const env = await startEnvironment({ port: 5205 });
const { check, ok } = env;
const sockets = [];
async function connect(path, client, origin = env.origin) {
  return new Promise((resolve, reject) => {
    const request = http.request(env.origin + path, { headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": randomBytes(16).toString("base64"), "Sec-WebSocket-Version": "13", Origin: origin, Cookie: client.cookieHeader() } });
    request.on("response", response => { response.resume(); resolve({ status: response.statusCode }); });
    request.on("error", reject);
    request.on("upgrade", (response, socket) => {
      sockets.push(socket); let input = Buffer.alloc(0); const messages = [], waiting = [];
      socket.on("data", chunk => {
        input = Buffer.concat([input, chunk]);
        while (input.length >= 2) {
          let size = input[1] & 127, offset = 2;
          if (size === 126) { if (input.length < 4) return; size = input.readUInt16BE(2); offset = 4; }
          if (input.length < offset + size) return;
          const opcode = input[0] & 15, payload = input.subarray(offset, offset + size); input = input.subarray(offset + size);
          if (opcode !== 1) continue;
          const value = JSON.parse(payload.toString());
          if (waiting.length) waiting.shift()(value); else messages.push(value);
        }
      });
      resolve({ status: response.statusCode, send(data) {
        const payload = Buffer.from(JSON.stringify(data)), mask = randomBytes(4);
        const header = Buffer.alloc(payload.length < 126 ? 6 : 8); header[0] = 0x81;
        if (payload.length < 126) header[1] = 0x80 | payload.length;
        else { header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
        mask.copy(header, header.length - 4);
        socket.write(Buffer.concat([header, Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]))]));
      }, next() { return messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("Signal timeout")), 5000); waiting.push(value => { clearTimeout(timeout); resolve(value); }); }); } });
    });
    request.end();
  });
}
try {
  const master = await env.verifiedClient("temp.master@example.test", "Mestre");
  const player = await env.verifiedClient("temp.player@example.test", "Jogador");
  const outsider = await env.verifiedClient("temp.out@example.test", "Fora");
  const campaign = await master("/api/campaigns", "POST", { name: "Temporárias", description: "", system: "Sistema livre" });
  const path = `/api/campaigns/${campaign.id}`;
  await player("/api/campaigns/join", "POST", { code: (await master(path)).inviteCode });
  const character = await player("/api/characters", "POST", { name: "Jogador", archetype: "", level: 1, hp: 10, maxHp: 10, strength: 10, agility: 10, intellect: 10, notes: "" });
  const session = await master(path + "/sessions", "POST", { title: "S", objective: "", mapKind: "tileset", mapKey: "crypt" });
  const base = `/api/sessions/${session.id}/temporary-image`;
  await player(`/api/sessions/${session.id}/join`, "POST", { characterId: character.id }, 204);
  await player(base, "POST", { title: "Não" }, 403);
  await outsider(base, "POST", { title: "Não" }, 404);
  await master(base, "POST", { title: "Sem CSRF" }, 400, { csrf: false });
  const shown = await master(base, "POST", { title: "Retrato" });
  check((await player(`/api/sessions/${session.id}/live`)).session.temporaryImageId, shown.id);
  check((await connect(base + "/signal", player, "https://evil.example")).status, 400);
  check((await connect(base + "/signal", outsider)).status, 404);
  const a = await connect(base + "/signal", master), b = await connect(base + "/signal", player);
  check(a.status, 101); check(b.status, 101);
  b.send({ kind: "ready", from: "forged" });
  const ready = await a.next(); check(ready.kind, "ready");
  ok(typeof ready.peerId === "string", "conexão tem identificador próprio");
  const playerId = (await player("/api/auth/me")).id;
  const masterId = (await master("/api/auth/me")).id;
  check(ready.from, playerId, "remetente vem do cookie");
  a.send({ kind: "offer", toPeer: ready.peerId, imageId: shown.id, payload: { type: "offer", sdp: "fixture" } });
  const offer = await b.next(); check(offer.from, masterId); check(offer.payload.sdp, "fixture");
  b.send({ kind: "answer", toPeer: offer.peerId, imageId: shown.id, payload: { type: "answer", sdp: "fixture answer" } });
  check((await a.next()).payload.sdp, "fixture answer");
  const second = await connect(base + "/signal", player); check(second.status, 101);
  check((await connect(base + "/signal", player)).status, 429);
  second.send({ kind: "ready" });
  const nextTab = await a.next(); ok(nextTab.peerId !== ready.peerId, "duas abas não compartilham negociação");
  a.send({ kind: "offer", toPeer: nextTab.peerId, imageId: shown.id, payload: { type: "offer", sdp: "segunda aba" } });
  check((await second.next()).payload.sdp, "segunda aba");
  await master(base, "DELETE", undefined, 204);
  check((await player(`/api/sessions/${session.id}/live`)).session.temporaryImageId, null);
  ok(!env.sql(`SELECT column_name FROM information_schema.columns WHERE table_name='Sessions'`).includes("Bytes"));
  await master(`/api/sessions/${session.id}/end`, "POST", undefined, 204);
  await master(base, "POST", { title: "Fim" }, 409);
  console.log(`PASS: ${env.count()} temporary image HTTP/WebSocket assertions; only metadata/signaling reaches server.`);
} finally { for (const socket of sockets) socket.destroy(); await env.stop(); }
