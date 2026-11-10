import { esc } from './ui.js';
import { state } from './state.js';
import { HELP_KEYS, validHelpKey, validTip, validHelpEntry, canReadHelp, catalogModule, safeHelpRoute } from './help-policy.js';

const localDevelopment = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const context = () => ({ isMaster: state.liveTable ? state.liveTable.isMaster === true : state.campaign?.isMaster === true, isPlayer: state.liveTable?.isMaster === false });
const known = (key) => validHelpKey(key) && Object.hasOwn(HELP_KEYS, key);
export function tip(text) {
  return validTip(text) ? `data-tip="${esc(text)}"` : '';
}
export function helpButton(key, label) {
  if (!known(key)) {
    if (localDevelopment()) console.warn('Chave de ajuda inexistente:', key);
    return '';
  }
  if (!canReadHelp(HELP_KEYS[key], state.user, context())) return '';
  return `<button type="button" class="help-button" data-help="${esc(key)}" aria-label="Ajuda: ${esc(label)}" aria-expanded="false" aria-controls="help-popup" aria-haspopup="dialog"><span aria-hidden="true">i</span></button>`;
}

let installed = false, popup, tooltip, trigger, tipTrigger, hoverTarget, focusedTarget;
let showTimer, hideTimer, request = 0, dismissed = false;
let reasonId = 0;
let descriptionId = 0;
let touchInput = false;
const catalogs = new Map();
function focusFallback() {
  const destination = document.querySelector('#modal[open] #close-modal') || document.querySelector('#main') || document.querySelector('#app');
  destination?.focus({ preventScroll: true });
}
function currentTrigger() {
  if (!trigger || trigger.isConnected && trigger.checkVisibility()) return trigger;
  return [...document.querySelectorAll('[data-help]')].find((el) => el.dataset.help === trigger.dataset.help && el.checkVisibility()) || null;
}
function restoreFocus() {
  const target = currentTrigger();
  trigger?.setAttribute('aria-expanded', 'false');
  target?.setAttribute('aria-expanded', 'false');
  trigger = null;
  if (target) target.focus({ preventScroll: true }); else focusFallback();
}
export function dismissHelp() {
  if (popup?.matches(':popover-open')) {
    ++request;
    popup.hidePopover();
    restoreFocus();
    return true;
  }
  if (tipTrigger || showTimer) {
    dismissed = true;
    hideTip();
    return true;
  }
  return false;
}
function describe(el, add) {
  const ids = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  if (add) ids.add('help-tooltip'); else ids.delete('help-tooltip');
  if (ids.size) el.setAttribute('aria-describedby', [...ids].join(' ')); else el.removeAttribute('aria-describedby');
}
function hideTip() {
  clearTimeout(showTimer); clearTimeout(hideTimer); showTimer = hideTimer = null;
  if (tipTrigger) describe(tipTrigger, false);
  tipTrigger = null;
  if (tooltip?.matches(':popover-open')) tooltip.hidePopover();
}
function mount(el, origin) {
  // Popovers abertos a partir do diálogo ficam dentro dele para não herdar a inércia do fundo.
  const parent = origin.closest('dialog[open]') || document.body;
  if (el.parentElement !== parent) parent.append(el);
}
function availableBottom() {
  let bottom = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : innerHeight;
  for (const el of document.querySelectorAll('.table-bottom, .turn-bar, .table-view-switch, .app-shell .sidebar nav')) {
    const css = getComputedStyle(el), rect = el.getBoundingClientRect();
    if (css.position === 'fixed' && rect.height && rect.top > innerHeight / 2) bottom = Math.min(bottom, rect.top);
  }
  return bottom;
}
function place(el, origin) {
  if (!origin?.isConnected) return;
  const bottom = availableBottom(), rect = origin.getBoundingClientRect();
  el.style.maxHeight = `${Math.max(44, bottom - 24)}px`;
  const size = el.getBoundingClientRect(), gap = 8;
  el.style.left = `${Math.max(8, Math.min(innerWidth - size.width - 8, rect.left + rect.width / 2 - size.width / 2))}px`;
  const above = rect.top - size.height - gap;
  el.style.top = `${Math.max(8, Math.min(bottom - size.height - 8, above >= 8 ? above : rect.bottom + gap))}px`;
}
function showTip(el) {
  clearTimeout(showTimer); showTimer = null;
  if (dismissed || !el.isConnected || !validTip(el.dataset.tip)) return;
  hideTip();
  tipTrigger = el;
  tooltip.textContent = el.dataset.tip;
  mount(tooltip, el);
  describe(el, true);
  tooltip.showPopover();
  place(tooltip, el);
}
function scheduleHideTip() {
  clearTimeout(showTimer); showTimer = null;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!hoverTarget && !focusedTarget) hideTip(); }, 160);
}
function textNode(tag, text, parent) {
  const el = document.createElement(tag); el.textContent = text; parent.append(el); return el;
}
function popupStatus(text) {
  popup.querySelector('#help-content').replaceChildren();
  const status = textNode('p', text, popup.querySelector('#help-content'));
  status.setAttribute('role', 'status');
}
async function openHelp(button) {
  const key = button.dataset.help;
  if (!known(key) || !canReadHelp(HELP_KEYS[key], state.user, context())) return;
  if (button === trigger && popup.matches(':popover-open')) { dismissHelp(); return; }
  hideTip();
  trigger?.setAttribute('aria-expanded', 'false');
  trigger = button;
  const version = ++request;
  button.setAttribute('aria-expanded', 'true');
  popup.querySelector('#help-title').textContent = button.getAttribute('aria-label')?.replace(/^Ajuda: /, '') || 'Ajuda';
  popupStatus('Carregando ajuda…');
  mount(popup, button);
  if (!popup.matches(':popover-open')) popup.showPopover();
  popup.focus({ preventScroll: true });
  const module = catalogModule(key);
  try {
    if (!catalogs.has(module)) catalogs.set(module, import(module).catch((error) => { catalogs.delete(module); throw error; }));
    const catalog = (await catalogs.get(module)).default;
    if (version !== request || !popup.matches(':popover-open')) return;
    const entry = catalog[key];
    if (!validHelpEntry(entry) || !canReadHelp(entry.audience, state.user, context())) throw new Error('Ajuda indisponível');
    popup.querySelector('#help-title').textContent = entry.title;
    const content = popup.querySelector('#help-content'); content.replaceChildren();
    textNode('p', entry.summary, content).className = 'help-summary';
    for (const part of entry.body) {
      if (typeof part === 'string') textNode('p', part, content);
      else { const list = document.createElement('ul'); for (const item of part.list) textNode('li', item, list); content.append(list); }
    }
    if (entry.example) textNode('p', `Exemplo: ${entry.example}`, content);
    if (entry.related) for (const related of entry.related) {
      if (!known(related) || !canReadHelp(HELP_KEYS[related], state.user, context())) continue;
      const relatedTitle = catalog[related]?.title || related.split('.').at(-1).replaceAll('-', ' ');
      const next = textNode('button', relatedTitle, content); next.type = 'button'; next.dataset.help = related;
      next.setAttribute('aria-label', `Ajuda: ${relatedTitle}`); next.setAttribute('aria-controls', 'help-popup'); next.setAttribute('aria-expanded', 'false'); next.setAttribute('aria-haspopup', 'dialog');
    }
    if (entry.route && safeHelpRoute(entry.route)) { const link = textNode('a', 'Saiba mais', content); link.href = entry.route; }
  } catch {
    if (version !== request || !popup.matches(':popover-open')) return;
    popupStatus('Não foi possível carregar esta ajuda.');
    const retry = textNode('button', 'Tentar novamente', popup.querySelector('#help-content'));
    retry.type = 'button'; retry.dataset.helpRetry = '';
  }
}

export function installHelp() {
  if (installed) return;
  installed = true;
  popup = document.createElement('section');
  popup.id = 'help-popup'; popup.className = 'help-popup metal';
  popup.setAttribute('popover', 'auto'); popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-labelledby', 'help-title'); popup.tabIndex = -1;
  const header = document.createElement('header'); popup.append(header);
  textNode('h2', 'Ajuda', header).id = 'help-title';
  const close = textNode('button', '×', header); close.type = 'button'; close.dataset.helpClose = ''; close.className = 'icon-button help-close'; close.setAttribute('aria-label', 'Fechar ajuda');
  const content = document.createElement('div'); content.id = 'help-content'; popup.append(content);
  tooltip = document.createElement('div'); tooltip.id = 'help-tooltip'; tooltip.className = 'tooltip'; tooltip.setAttribute('role', 'tooltip'); tooltip.setAttribute('popover', 'manual');
  document.body.append(popup, tooltip);
  document.addEventListener('pointerdown', (event) => {
    touchInput = event.pointerType === 'touch';
    if (touchInput) hideTip();
  }, true);
  const enhance = (root) => {
    // Liga também as instruções visíveis dos formulários antigos ao respectivo controle.
    const groups = [...(root.matches?.('.field, label') ? [root] : []), ...root.querySelectorAll('.field, label')];
    for (const group of groups) {
      const controls = [...group.querySelectorAll('input:not([type=hidden]), select, textarea')];
      if (!controls.length) continue;
      // A contagem de caracteres (ui.js) é descrição própria do campo, não substitui a dica.
      let hints = [...group.querySelectorAll('small:not([aria-hidden=true]):not(.char-count)')];
      const ownDescription = (input) => (input.getAttribute('aria-describedby') || '').split(/\s+/).some((id) => id && !id.startsWith('char-count-'));
      // Filtros e buscas não ganham dica automática: só filtram listas, e a dica desalinha a barra horizontal.
      // Limite sozinho só aparece em texto longo; num campo curto opcional o navegador já impede passar do limite.
      if (!hints.length && group.matches('.field') && !group.closest('[role=search]') && controls.length === 1 && controls[0].type !== 'search' && !ownDescription(controls[0])) {
        const input = controls[0], parts = [];
        if (input.required) parts.push('Campo obrigatório.');
        if (input.hasAttribute('minlength')) parts.push(`Mínimo de ${input.getAttribute('minlength')} caracteres.`);
        // Limite de caracteres: a contagem "usados/limite" já aparece no campo (ui.js).
        if (input.type === 'number') {
          if (input.min && input.max) parts.push(`Use de ${input.min} a ${input.max}.`);
          else if (input.min) parts.push(`Mínimo: ${input.min}.`);
          else if (input.max) parts.push(`Máximo: ${input.max}.`);
        }
        if (parts.length) { const hint = textNode('small', parts.join(' '), group); hint.className = 'form-help'; hints = [hint]; }
      }
      for (const hint of hints) {
        if (!hint.id) hint.id = `help-description-${++descriptionId}`;
        for (const input of controls) {
          const ids = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
          ids.add(hint.id); input.setAttribute('aria-describedby', [...ids].join(' '));
        }
      }
    }
    const elements = [...(root.matches?.('[data-tip], button[aria-label]') ? [root] : []), ...root.querySelectorAll('[data-tip], button[aria-label]')];
    for (const el of elements) {
      // Botões de fechar (×) já são óbvios: sem tooltip "Fechar" sobre o X.
      if (!el.dataset.tip && el.matches('button[aria-label]:not([data-help]):not([data-help-close]):not(#close-modal)') && !/^Fechar\b/.test(el.getAttribute('aria-label')) && !/\p{L}/u.test(el.textContent)) {
        const name = el.getAttribute('aria-label');
        if (validTip(name)) el.dataset.tip = name;
      }
      if (!el.dataset.tip) continue;
      const owner = el.closest('button, a[href]');
      if (owner && owner !== el && !owner.dataset.tip && validTip(el.dataset.tip)) owner.dataset.tip = el.dataset.tip;
      if (!el.matches('button, input, select, textarea, a[href], [tabindex]') && !el.closest('button, a[href]')) el.tabIndex = 0;
      if (el.matches('[aria-disabled="true"]') && !el.dataset.helpReason && !el.hasAttribute('aria-describedby')) {
        const reason = document.createElement('small'); reason.className = 'form-help help-disabled-reason'; reason.id = `help-reason-${++reasonId}`;
        reason.textContent = el.dataset.tip;
        el.after(reason); el.dataset.helpReason = reason.id;
        el.setAttribute('aria-describedby', [el.getAttribute('aria-describedby'), reason.id].filter(Boolean).join(' '));
      }
    }
  };
  enhance(document);
  popup.addEventListener('toggle', () => {
    if (!popup.matches(':popover-open') && trigger) { ++request; restoreFocus(); }
  });
  // Capture bloqueia aria-disabled antes de handlers locais ou delegados de funcionalidades.
  document.addEventListener('click', (event) => {
    if (event.target.closest('[aria-disabled="true"]')) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (event.target.closest('[data-help-close]')) { dismissHelp(); return; }
    if (event.target.closest('[data-help-retry]')) { const target = currentTrigger(); trigger = null; if (target) openHelp(target); return; }
    const button = event.target.closest('[data-help]');
    if (button) { event.preventDefault(); event.stopPropagation(); openHelp(button); }
  }, true);
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const target = event.target.closest('[data-tip], #help-tooltip');
    if (!target || target.contains(event.relatedTarget)) return;
    hoverTarget = target; clearTimeout(hideTimer);
    if (target === tooltip) return;
    dismissed = false; clearTimeout(showTimer);
    showTimer = setTimeout(() => showTip(target), 400);
  });
  document.addEventListener('pointerout', (event) => {
    const target = event.target.closest('[data-tip], #help-tooltip');
    if (!target || target.contains(event.relatedTarget)) return;
    hoverTarget = event.relatedTarget?.closest?.('[data-tip], #help-tooltip') || null;
    scheduleHideTip();
  });
  document.addEventListener('focusin', (event) => {
    const target = event.target.closest('[data-tip]');
    focusedTarget = target;
    if (target && !touchInput) { dismissed = false; showTip(target); }
  });
  document.addEventListener('focusout', (event) => {
    if (!event.target.closest('[data-tip]')) return;
    focusedTarget = event.relatedTarget?.closest?.('[data-tip]') || null;
    scheduleHideTip();
  });
  document.addEventListener('keydown', (event) => {
    touchInput = false;
    if (event.key === 'Escape' && dismissHelp()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const reposition = () => {
    if (tipTrigger?.isConnected) place(tooltip, tipTrigger); else if (tipTrigger) hideTip();
  };
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);
  window.visualViewport?.addEventListener('resize', reposition);
  window.addEventListener('hashchange', () => { hideTip(); if (popup.matches(':popover-open')) dismissHelp(); });
  new MutationObserver((changes) => {
    for (const change of changes) for (const node of change.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) enhance(node);
    if (tipTrigger && !tipTrigger.isConnected) hideTip();
    if (!trigger || trigger.isConnected || !popup.matches(':popover-open')) return;
    const replacement = currentTrigger();
    if (replacement) { trigger = replacement; trigger.setAttribute('aria-expanded', 'true'); }
    else dismissHelp();
  }).observe(document.body, { childList: true, subtree: true });
}
