// Verificação de alinhamento de formulários executada no navegador (Playwright page.evaluate).
// Em cada formulário, controles de uma linha (input, select, botão) que ocupam a mesma faixa vertical precisam ter
// o mesmo topo e a mesma base (±1,5 px). Ignora controles que não formam linhas de formulário: listas, tabelas,
// mapas, dados, ícones e botões de texto.
export function formAlignmentIssues(rootSelector = 'body') {
  const root = document.querySelector(rootSelector) || document.body;
  const visible = (e) => e.checkVisibility() && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  const describe = (e) => {
    const label = e.labels?.[0]?.textContent || e.getAttribute('aria-label') || e.textContent || e.name || e.id || e.tagName;
    return `${e.tagName.toLowerCase()}「${String(label).trim().replace(/\s+/g, ' ').slice(0, 28)}」`;
  };
  const issues = [];
  for (const form of root.querySelectorAll('form')) {
    if (!visible(form)) continue;
    const controls = [...form.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=range]), select, button')]
      .filter(visible)
      .filter((e) => !e.matches('.help-button, .icon-button, .text-button, .eye, [data-help], .tool, .die-choice, [data-fav]'))
      .filter((e) => !e.closest('table, ul, ol, .board, .map-choice, .fx-grid, .password-wrap button'));
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
        const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlap < Math.min(a.height, b.height) * 0.5) continue;
        if (Math.abs(a.top - b.top) > 1.5 || Math.abs(a.bottom - b.bottom) > 1.5) {
          issues.push(`${form.id || form.className || 'form'}: ${describe(controls[i])} × ${describe(controls[j])} Δtopo ${Math.round(b.top - a.top)} Δbase ${Math.round(b.bottom - a.bottom)}`);
        }
      }
    }
  }
  return [...new Set(issues)];
}

// Foco visível cortado: foca cada controle visível (após uma tecla, para valer :focus-visible) e confere se o contorno
// (outline + offset) cabe dentro de todos os ancestrais que cortam conteúdo (overflow ≠ visible). Só avalia controles
// que já estão inteiros na área visível do ancestral; os que estão fora da rolagem são ignorados.
export function focusClipIssues(rootSelector = 'body') {
  const root = document.querySelector(rootSelector) || document.body;
  const visible = (e) => e.checkVisibility() && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  const items = [...root.querySelectorAll('input:not([type=hidden]), select, textarea, button, a[href], summary, [tabindex="0"]')].filter(visible).slice(0, 120);
  const issues = [];
  const before = document.activeElement;
  for (const el of items) {
    // Com movimento reduzido, a regra global encurta transições (0,01 ms) e a leitura imediata pegaria o valor inicial.
    const target0 = el.matches('.interface-option input') ? el.nextElementSibling : el;
    target0.style.transitionProperty = 'none';
    el.focus({ preventScroll: true });
    const tcs0 = getComputedStyle(target0); void tcs0.outlineWidth; // calcula já sem transição
    target0.style.removeProperty('transition-property');
    if (document.activeElement !== el && !el.matches('input[type=radio], input[type=checkbox]')) continue;
    const cs = getComputedStyle(el);
    const target = el.matches('.interface-option input') ? el.nextElementSibling : el;
    const tcs = target === el ? cs : getComputedStyle(target);
    // Sem contorno (ex.: campos com foco interno), nada vaza para fora da caixa.
    if (tcs.outlineStyle === 'none' || parseFloat(tcs.opacity) === 0) continue; // input invisível: o foco aparece no cartão
    const reach = Math.max(0, (parseFloat(tcs.outlineWidth) || 0) + (parseFloat(tcs.outlineOffset) || 0));
    if (!reach) continue;
    const r = target.getBoundingClientRect();
    const box = { left: r.left - reach, right: r.right + reach, top: r.top - reach, bottom: r.bottom + reach };
    for (let a = target.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflowX === 'visible' && acs.overflowY === 'visible') continue;
      // Compara com os limites do conteúdo rolável (posição de rolagem zerada), não com a parte visível agora:
      // perto da borda durante a rolagem o corte é natural; na borda do conteúdo, nunca dá para ver o anel inteiro.
      const ar = a.getBoundingClientRect();
      const x = r.left - (ar.left + a.clientLeft) + a.scrollLeft, y = r.top - (ar.top + a.clientTop) + a.scrollTop;
      const clipX = acs.overflowX !== 'visible', clipY = acs.overflowY !== 'visible';
      const width = Math.max(a.scrollWidth, a.clientWidth), height = Math.max(a.scrollHeight, a.clientHeight);
      if ((clipX && (x - reach < -0.5 || x + r.width + reach > width + 0.5)) || (clipY && (y - reach < -0.5 || y + r.height + reach > height + 0.5))) {
        const label = (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 28);
        issues.push(`foco cortado: ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}「${label}」 por ${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0] || a.id} (outline ${tcs.outlineWidth} ${tcs.outlineOffset})`);
        break;
      }
      break; // só o primeiro ancestral que corta: acima dele as posições já são do conteúdo rolado
    }
  }
  before?.focus?.({ preventScroll: true });
  return [...new Set(issues)];
}
