import { helpButton } from "./help.js";
import { api } from "./api.js";
import { toast } from "./ui.js";

// Bytes ficam apenas no navegador. O servidor transmite somente SDP/ICE autenticados.
const MAX_BYTES = 5 * 1024 * 1024;
const CHUNK = 16384;
export function mountTemporaryImages(sessionId, host) {
  let state, socket, disposed = false, imageId, localImage, localImageId, objectUrl, reconnect;
  const abort = new AbortController();
  let iceServers = [], connecting = false;
  const peers = new Map(), candidates = new Map(), peerStarted = new Map();
  const panel = document.createElement("section");
  panel.className = "temporary-image-panel metal";
  panel.innerHTML = `<details class="temporary-controls" hidden><summary>Apresentar imagem temporária</summary>${helpButton("mesa.imagens.temporarias", "Imagens temporárias")}<label>Imagem (JPEG/PNG, até 5 MiB)<input type="file" accept="image/jpeg,image/png"></label><button type="button" class="subtle" data-hide>Retirar imagem</button><p class="muted">Transmitida entre navegadores. Mantenha esta aba aberta. Outros participantes podem capturar a imagem.</p></details><p class="temporary-status" role="status"></p><figure hidden><figcaption></figcaption><img alt=""></figure>`;
  host.append(panel);
  const controls = panel.querySelector(".temporary-controls"), status = panel.querySelector(".temporary-status");
  const figure = panel.querySelector("figure"), img = panel.querySelector("img");
  const fileInput = panel.querySelector("input");
  const base = `/sessions/${sessionId}/temporary-image`;
  const message = (text) => { if (!disposed) status.textContent = text; };
  function clearImage() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined; img.removeAttribute("src"); figure.hidden = true;
  }
  function display(blob) {
    if (disposed) return;
    clearImage(); objectUrl = URL.createObjectURL(blob); img.src = objectUrl;
    img.alt = state?.session.temporaryImageTitle || "Imagem apresentada pelo mestre";
    panel.querySelector("figcaption").textContent = img.alt; figure.hidden = false; message("");
  }
  function closePeers() { for (const p of peers.values()) p.close(); peers.clear(); candidates.clear(); peerStarted.clear(); }
  function send(kind, to, payload) {
    if (!disposed && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind, toPeer: to, imageId, payload }));
  }
  function ready() { if (imageId && !state?.me.isMaster) send("ready"); }
  async function transmit(channel, blob, id) {
    if (id !== imageId || disposed) return;
    channel.send(JSON.stringify({ id, size: blob.size, type: "image/jpeg" }));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let i = 0; i < bytes.length; i += CHUNK) {
      if (id !== imageId || disposed || channel.readyState !== "open") return;
      while (channel.bufferedAmount > 262144 && channel.readyState === "open" && !disposed)
        await new Promise((resolve) => setTimeout(resolve, 30));
      if (channel.readyState === "open") channel.send(bytes.slice(i, i + CHUNK));
    }
  }
  function receive(channel) {
    const expectedId = imageId;
    channel.binaryType = "arraybuffer";
    let header, chunks = [], received = 0;
    channel.onmessage = ({ data }) => {
      if (disposed || imageId !== expectedId) return;
      if (typeof data === "string") {
        try {
          header = JSON.parse(data); chunks = []; received = 0;
          if (header.id !== imageId || header.type !== "image/jpeg" || !Number.isInteger(header.size) || header.size < 1 || header.size > MAX_BYTES) channel.close();
        } catch { channel.close(); }
        return;
      }
      if (!header || header.id !== imageId || !(data instanceof ArrayBuffer)) return;
      received += data.byteLength;
      if (received > header.size || data.byteLength > CHUNK) { channel.close(); return; }
      chunks.push(data);
      if (received === header.size) { display(new Blob(chunks, { type: "image/jpeg" })); chunks = []; header = null; }
    };
  }
  function peer(user) {
    peers.get(user)?.close();
    const p = new RTCPeerConnection({ iceServers }); peers.set(user, p); peerStarted.set(user, performance.now());
    if (!candidates.has(user)) candidates.set(user, []);
    const expectedId = imageId;
    p.onicecandidate = ({ candidate }) => { if (candidate && currentPeer(user, p, expectedId)) send("ice", user, candidate.toJSON()); };
    p.ondatachannel = ({ channel }) => receive(channel);
    p.onconnectionstatechange = () => {
      if (p.connectionState === "failed") message("Não foi possível conectar aos navegadores. Tente novamente; esta rede pode exigir TURN configurado pelo operador.");
    };
    return p;
  }
  function currentPeer(user, p, id) { return !disposed && id === imageId && peers.get(user) === p; }
  async function flushCandidates(user, p) {
    for (const candidate of candidates.get(user) || []) await p.addIceCandidate(candidate);
    candidates.set(user, []);
  }
  async function signal(data) {
    if (disposed || !imageId || data.imageId !== imageId) return;
    const user = data.peerId;
    const signalImageId = imageId;
    if (!user) return;
    if (data.kind === "ready" && state.me.isMaster && localImage && localImageId === imageId) {
      const existing = peers.get(user);
      if (existing && ["new", "connecting", "connected"].includes(existing.connectionState) && performance.now() - peerStarted.get(user) < 15000) return;
      const p = peer(user), channel = p.createDataChannel("image");
      const id = imageId; channel.onopen = () => transmit(channel, localImage, id).catch(() => message("Transmissão interrompida. Reapresente a imagem."));
      await p.setLocalDescription(await p.createOffer()); if (currentPeer(user, p, signalImageId)) send("offer", user, p.localDescription);
    } else if (data.kind === "offer" && !state.me.isMaster) {
      const p = peer(user); await p.setRemoteDescription(data.payload);
      if (!currentPeer(user, p, signalImageId)) return;
      await flushCandidates(user, p);
      await p.setLocalDescription(await p.createAnswer()); if (currentPeer(user, p, signalImageId)) send("answer", user, p.localDescription);
    } else if (data.kind === "answer" && state.me.isMaster) {
      const p = peers.get(user); if (p) { await p.setRemoteDescription(data.payload); if (currentPeer(user, p, signalImageId)) await flushCandidates(user, p); }
    } else if (data.kind === "ice") {
      const p = peers.get(user); if (p?.remoteDescription) await p.addIceCandidate(data.payload);
      else if ((candidates.get(user)?.length || 0) < 64) { if (!candidates.has(user)) candidates.set(user, []); candidates.get(user).push(data.payload); }
    }
  }
  async function connect() {
    if (connecting || disposed || socket?.readyState === WebSocket.OPEN) return;
    connecting = true;
    try {
      ({ iceServers } = await api(`${base}/ice`, "GET", undefined, { background: true, signal: abort.signal }));
      if (disposed) return;
      const url = new URL(`/api${base}/signal`, location.origin); url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = ready;
      socket.onmessage = ({ data }) => { try { signal(JSON.parse(data)).catch(() => message("Conexão da imagem interrompida. Tente reapresentar.")); } catch {} };
      socket.onclose = () => {
        if (!disposed) { message(imageId ? "Reconectando a apresentação…" : ""); reconnect = setTimeout(connect, 5000); }
      };
    } catch { if (!disposed) { message("Apresentação indisponível. Tentando reconectar…"); reconnect = setTimeout(connect, 5000); } }
    finally { connecting = false; }
  }
  fileInput.onchange = async () => {
    const file = fileInput.files[0]; if (!file) return;
    fileInput.disabled = true;
    try {
      if (!["image/jpeg", "image/png"].includes(file.type) || file.size > MAX_BYTES) throw new Error("Use JPEG ou PNG de até 5 MiB.");
      message("Preparando imagem…");
      const bitmap = await createImageBitmap(file);
      if (disposed) { bitmap.close(); return; }
      if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 32000000) { bitmap.close(); throw new Error("Imagem excede 8.192 px por lado ou 32 milhões de pixels."); }
      const canvas = document.createElement("canvas"), scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const normalized = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (disposed) return;
      if (!normalized || normalized.size > MAX_BYTES) throw new Error("Não foi possível preparar esta imagem.");
      const result = await api(base, "POST", { title: file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Imagem temporária" }, { signal: abort.signal });
      if (disposed) return;
      localImage = normalized; closePeers(); imageId = result.id; localImageId = result.id;
      // Long-poll publica o id aos outros participantes; eles solicitam a transmissão ao mestre.
      display(localImage); message("Apresentando. Mantenha esta aba aberta.");
    } catch (error) { if (!disposed && error.name !== "AbortError") { message(error.message); toast(error.message); } }
    finally { fileInput.disabled = false; fileInput.value = ""; }
  };
  panel.querySelector("[data-hide]").onclick = async () => {
    try { await api(base, "DELETE", undefined, { signal: abort.signal }); if (!disposed) { localImage = null; localImageId = null; imageId = null; closePeers(); clearImage(); message(""); } }
    catch (error) { if (!disposed && error.name !== "AbortError") message(error.message); }
  };
  const retry = setInterval(() => { if (imageId && figure.hidden && !state?.me.isMaster) ready(); }, 10000);
  return {
    update(next) {
      state = next; controls.hidden = !next.me.isMaster;
      panel.hidden = !next.me.isMaster && !next.session.temporaryImageId;
      if (next.session.endedAt) { this.dispose(); return; }
      const nextId = next.session.temporaryImageId;
      if (nextId !== imageId) {
        closePeers(); clearImage(); imageId = nextId;
        if (localImageId !== nextId) { localImage = null; localImageId = null; }
        if (!next.me.isMaster) { localImage = null; message(imageId ? "Aguardando imagem do mestre…" : ""); ready(); }
        else if (imageId && !localImage) message("A imagem estava nesta aba. Selecione o arquivo novamente para apresentar.");
      }
      if (!socket || socket.readyState === WebSocket.CLOSED) connect();
    },
    dispose() { disposed = true; abort.abort(); clearInterval(retry); clearTimeout(reconnect); socket?.close(); closePeers(); localImage = null; localImageId = null; clearImage(); panel.remove(); },
  };
}
