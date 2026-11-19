// Convidados da mesa — painel do mestre (ADR-114). Carregado sob demanda pela mesa (interface Completa, Busca de ações).
// Liga/desliga convidados na campanha, cria convites (modo, duração e usos predefinidos) e revoga convites e assentos.
// O link com o segredo aparece uma única vez, só enquanto o painel está aberto: nunca é guardado nem registrado.
import { api } from "./api.js";
import { $, esc, toast, modal, rowAction } from "./ui.js";
import { helpButton } from "./help.js";
import { GUEST_DURATIONS, DEFAULT_DURATION, GUEST_USES, DEFAULT_USES, GUEST_MODES, inviteRequest, inviteStatus, inviteLink } from "./guest-policy.js";

const when = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

export function openGuestsModal({ campaignId }) {
  const path = `/campaigns/${campaignId}`;
  modal("Convidados da mesa", `<p class="loading-line" role="status">Carregando convidados…</p>`);
  const dialog = $("#modal"), body = $("#modal-body");
  body.classList.add("guest-admin-body");
  let data = null, created = null, busy = false, closed = false;
  const request = (p, method = "GET", payload) => api(p, method, payload, { background: true });

  async function load() {
    try {
      data = await request(`${path}/guest-invites`);
      if (!closed) render();
    } catch (error) {
      if (closed) return;
      body.innerHTML = `<p class="form-error" role="alert">${esc(error.message)}</p><div class="form-actions"><button type="button" class="primary" data-action="gm-reload">Tentar de novo</button></div>`;
    }
  }

  function linkBox() {
    if (!created) return "";
    return `<section class="guest-link notice-box" aria-labelledby="gm-link-title"><h3 id="gm-link-title">Link do convite (${esc(GUEST_MODES[created.mode]?.label || "")})</h3>`
      + `<div class="guest-inline"><label class="sr-only" for="gm-link">Link do convite</label><input id="gm-link" readonly value="${esc(created.link)}" aria-describedby="gm-link-warn">`
      + `<button type="button" class="primary" data-action="gm-copy">Copiar link</button></div>`
      + `<p class="form-help" id="gm-link-warn"><strong>Quem tiver o link entra; revogue quando terminar.</strong> O link aparece só agora e não fica guardado.</p></section>`;
  }

  function inviteForm() {
    const modes = Object.entries(GUEST_MODES).map(([id, m], i) => `<label class="check"><input type="radio" name="mode" value="${id}" ${i === 0 ? "checked" : ""} aria-describedby="gm-mode-${id}"> ${esc(m.label)}</label><small class="form-help" id="gm-mode-${id}">${esc(m.hint)}</small>`).join("");
    return `<form id="gm-invite" class="guest-invite-form" autocomplete="off"><fieldset><legend>Novo convite</legend>${modes}</fieldset>`
      + `<div class="guest-invite-grid"><div class="field"><label for="gm-hours">Vale por</label><select id="gm-hours" name="hours">${GUEST_DURATIONS.map((d) => `<option value="${d.hours}" ${d.hours === DEFAULT_DURATION ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select></div>`
      + `<div class="field"><label for="gm-uses">Pessoas que podem usar</label><select id="gm-uses" name="maxUses">${GUEST_USES.map((u) => `<option value="${u}" ${u === DEFAULT_USES ? "selected" : ""}>${u}</option>`).join("")}</select></div>`
      + `<div class="field"><label for="gm-label">Identificação (opcional)</label><input id="gm-label" name="label" maxlength="60" placeholder="Ex.: amigo da Ana" aria-describedby="gm-label-hint"><small class="form-help" id="gm-label-hint">Só você vê, para reconhecer o convite na lista.</small></div></div>`
      + `<p class="form-error" data-form-error role="alert"></p><div class="form-actions"><button type="submit" class="primary">Criar convite</button></div></form>`;
  }

  function inviteItem(inv) {
    const s = inviteStatus(inv);
    const name = inv.label || GUEST_MODES[inv.mode]?.label || "Convite";
    const meta = [GUEST_MODES[inv.mode]?.label, `${Number(inv.uses) || 0}/${Number(inv.maxUses) || 0} usos`, s.id === "active" ? `até ${when(inv.expiresAt)}` : ""].filter(Boolean).join(" · ");
    return `<li class="guest-row ${s.id}"><div><strong>${esc(name)}</strong><small>${esc(meta)}</small></div><span class="guest-state ${s.id}">${esc(s.label)}</span>${s.id === "active" ? rowAction("trash", "Revogar", name, "gm-revoke-invite", inv.id, "subtle small danger") : ""}</li>`;
  }
  function seatItem(seat) {
    const meta = [GUEST_MODES[seat.mode]?.label, seat.online ? "Conectado" : "Ausente", seat.tokenLabel ? `controla ${seat.tokenLabel}` : ""].filter(Boolean).join(" · ");
    return `<li class="guest-row ${seat.revokedAt ? "revoked" : ""}"><div><strong>${esc(seat.name)}</strong><small>${esc(meta)}</small></div>${seat.revokedAt ? `<span class="guest-state revoked">Revogado</span>` : rowAction("trash", "Revogar acesso", seat.name, "gm-revoke-seat", seat.id, "subtle small danger")}</li>`;
  }

  function render() {
    const invites = data.invites || [], seats = (data.seats || []).filter((s) => !s.revokedAt);
    const active = invites.filter((i) => inviteStatus(i).id === "active"), old = invites.filter((i) => inviteStatus(i).id !== "active");
    body.innerHTML = `<div class="guest-admin">`
      + `<div class="setting-check"><div class="field-label"><label class="check" for="gm-enabled"><input type="checkbox" id="gm-enabled" ${data.enabled ? "checked" : ""} aria-describedby="gm-enabled-hint"><strong>Permitir convidados nesta campanha</strong></label>${helpButton("mesa.convidados.gerenciar", "Convidados da mesa")}</div>`
      + `<small class="form-help" id="gm-enabled-hint">Convidados entram sem conta por um link temporário, só na sessão aberta. Desligar revoga todos os convites e acessos.</small></div>`
      + linkBox()
      + (data.enabled ? inviteForm() : `<p class="muted small">Ligue a opção acima para criar convites.</p>`)
      + `<h3>Na mesa agora</h3>${seats.length ? `<ul class="guest-list">${seats.map(seatItem).join("")}</ul>` : `<p class="muted small">Nenhum convidado entrou ainda.</p>`}`
      + `<h3>Convites ativos</h3>${active.length ? `<ul class="guest-list">${active.map(inviteItem).join("")}</ul>` : `<p class="muted small">Nenhum convite ativo.</p>`}`
      + (old.length ? `<details class="guest-old"><summary>Convites encerrados (${old.length})</summary><ul class="guest-list">${old.map(inviteItem).join("")}</ul></details>` : "")
      + `</div>`;
  }

  async function guard(task) {
    if (busy) return;
    busy = true;
    body.setAttribute("aria-busy", "true");
    try { await task(); } catch (error) { toast(error.message); } finally { busy = false; body.removeAttribute("aria-busy"); }
  }

  const onChange = (e) => {
    if (e.target.id !== "gm-enabled") return;
    const on = e.target.checked;
    if (!on && !confirm("Desligar convidados revoga todos os convites e encerra o acesso de quem está na mesa como convidado. Continuar?")) { e.target.checked = true; return; }
    guard(async () => {
      await request(`${path}/guests`, "PUT", { enabled: on });
      if (!on) created = null;
      toast(on ? "Convidados permitidos nesta campanha." : "Convidados desligados; convites e acessos revogados.");
      await load();
    }).finally(() => { if (!closed && data && e.target.isConnected) e.target.checked = !!data.enabled; });
  };
  const onSubmit = (e) => {
    if (e.target.id !== "gm-invite") return;
    e.preventDefault();
    const form = e.target, error = form.querySelector("[data-form-error]");
    error.textContent = "";
    guard(async () => {
      try {
        const r = await request(`${path}/guest-invites`, "POST", inviteRequest(Object.fromEntries(new FormData(form))));
        const link = inviteLink(r?.path, location.origin);
        created = link ? { link, mode: r.mode } : null;
        if (!link) toast("Convite criado, mas o link recebido é inválido. Revogue-o e tente de novo.");
      } catch (err) { error.textContent = err.message; return; }
      await load();
      $("#gm-link")?.focus();
      $("#gm-link")?.select();
    });
  };
  const onClick = (e) => {
    const b = e.target.closest("[data-action^='gm-']");
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    if (b.dataset.action === "gm-reload") { body.innerHTML = `<p class="loading-line" role="status">Carregando convidados…</p>`; load(); }
    if (b.dataset.action === "gm-copy") copy();
    if (b.dataset.action === "gm-revoke-invite") guard(async () => { await request(`${path}/guest-invites/${encodeURIComponent(id)}`, "DELETE"); toast("Convite revogado."); await load(); });
    if (b.dataset.action === "gm-revoke-seat" && confirm("Revogar o acesso deste convidado? Ele sai da mesa na hora.")) guard(async () => { await request(`${path}/guest-seats/${encodeURIComponent(id)}`, "DELETE"); toast("Acesso do convidado revogado."); await load(); });
  };
  async function copy() {
    const input = $("#gm-link");
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
      toast("Link copiado. Envie só para quem você quer na mesa.");
    } catch {
      input.focus(); input.select();
      toast("Copie o link selecionado (Ctrl+C ou toque longo).");
    }
  }
  body.addEventListener("change", onChange);
  body.addEventListener("submit", onSubmit);
  body.addEventListener("click", onClick);
  dialog.addEventListener("close", () => {
    closed = true;
    created = null; // o segredo some com o painel
    body.classList.remove("guest-admin-body");
    body.removeEventListener("change", onChange);
    body.removeEventListener("submit", onSubmit);
    body.removeEventListener("click", onClick);
  }, { once: true });
  load();
}
