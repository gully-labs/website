// Floating UI wrappers: tooltip, popover, menu. Positioned with flip + shift so they never leave the screen; Esc closes,
// focus returns to the trigger; menus take arrow keys. Text only through textContent.
//   tooltip(trigger, 'Liquidity under $500')
//   popover(trigger, contentNode, { placement: 'bottom-start' })  -> { open(), close(), destroy() }
//   menu(trigger, [{ label: 'Copy link', icon: 'copy', onSelect }, { label: 'Docs', href: '/docs' }])
import { computePosition, autoUpdate, offset, flip, shift } from './vendor/floating.js';
import { css, el as mk } from './core.js';
import { icon } from './icons.js';

let uid = 0;
function place(trigger, floating, placement) {
  return autoUpdate(trigger, floating, () => {
    computePosition(trigger, floating, { placement, strategy: 'fixed', middleware: [offset(8), flip(), shift({ padding: 8 })] })
      .then(({ x, y, placement: p }) => { Object.assign(floating.style, { left: `${x}px`, top: `${y}px` }); floating.dataset.placement = p; });
  });
}

export function tooltip(trigger, text, { placement = 'top' } = {}) {
  css('./ui-kit.css');
  const tip = mk('div', 'gu-tip', text);
  tip.id = `gu-tip-${++uid}`; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.appendChild(tip);
  trigger.setAttribute('aria-describedby', tip.id);
  let stop = null, t = 0;
  const show = () => { clearTimeout(t); t = setTimeout(() => { tip.hidden = false; stop ||= place(trigger, tip, placement); }, 120); };
  const hide = () => { clearTimeout(t); tip.hidden = true; stop?.(); stop = null; };
  const key = (e) => { if (e.key === 'Escape') hide(); };
  const on = [['pointerenter', show], ['pointerleave', hide], ['focus', show], ['blur', hide], ['keydown', key]];
  on.forEach(([e, f]) => trigger.addEventListener(e, f));
  return { set(text2) { tip.textContent = text2; }, destroy() { hide(); on.forEach(([e, f]) => trigger.removeEventListener(e, f)); tip.remove(); } };
}

export function popover(trigger, content, { placement = 'bottom-start', role = 'dialog', label } = {}) {
  css('./ui-kit.css');
  const box = mk('div', 'gu-pop');
  box.id = `gu-pop-${++uid}`; box.setAttribute('role', role); box.hidden = true; box.tabIndex = -1;
  if (label) box.setAttribute('aria-label', label);
  box.appendChild(content);
  document.body.appendChild(box);
  trigger.setAttribute('aria-haspopup', role === 'menu' ? 'menu' : 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', box.id);
  let stop = null;
  const outside = (e) => { if (!box.contains(e.target) && !trigger.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); trigger.focus(); } };
  function open() {
    if (!box.hidden) return;
    box.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    stop = place(trigger, box, placement);
    document.addEventListener('pointerdown', outside, true);
    box.addEventListener('keydown', esc);
    (box.querySelector('[role="menuitem"], button, a, input, [tabindex="0"]') || box).focus({ preventScroll: true });
  }
  function close() {
    if (box.hidden) return;
    box.hidden = true; trigger.setAttribute('aria-expanded', 'false');
    stop?.(); stop = null;
    document.removeEventListener('pointerdown', outside, true);
    box.removeEventListener('keydown', esc);
  }
  const toggle = () => (box.hidden ? open() : close());
  trigger.addEventListener('click', toggle);
  return { el: box, open, close, destroy() { close(); trigger.removeEventListener('click', toggle); box.remove(); } };
}

export function menu(trigger, items, opts = {}) {
  const list = mk('div', 'gu-menu');
  const nodes = items.map((it) => {
    const n = it.href ? mk('a', 'gu-menu-item') : mk('button', 'gu-menu-item');
    if (it.href) { n.href = it.href; if (/^https?:/.test(it.href) && !it.href.startsWith(location.origin)) { n.target = '_blank'; n.rel = 'noopener'; } } else n.type = 'button';
    n.setAttribute('role', 'menuitem'); n.tabIndex = -1;
    if (it.icon) n.appendChild(icon(it.icon, { size: 16 }));
    n.appendChild(mk('span', null, it.label));
    if (it.danger) n.classList.add('gu-danger');
    n.addEventListener('click', () => { it.onSelect?.(); p.close(); trigger.focus(); });
    return n;
  });
  nodes.forEach((n) => list.appendChild(n));
  const p = popover(trigger, list, { ...opts, role: 'menu' });
  list.addEventListener('keydown', (e) => {
    const i = nodes.indexOf(document.activeElement);
    const go = (j) => { e.preventDefault(); nodes[(j + nodes.length) % nodes.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1); else if (e.key === 'Home') go(0); else if (e.key === 'End') go(nodes.length - 1);
  });
  return p;
}
