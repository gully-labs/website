// Lucide icons (ISC), a curated set (build/icons.json) built as SVG nodes with createElementNS: no innerHTML, no sprite
// requests. Icons inherit currentColor, so they follow the text tokens.
//   icon('wallet', { size: 20, label: 'Wallet' })  -> <svg> (aria-hidden unless a label is given)
import { createElement, ICONS } from './vendor/lucide.js';

export const ICON_NAMES = Object.keys(ICONS);
export function icon(name, { size = 20, label, stroke = 2, className } = {}) {
  const node = ICONS[name];
  if (!node) throw new Error(`gully-ui-kit: no icon ${name} (add it to build/icons.json)`);
  const svg = createElement(node, { width: size, height: size, 'stroke-width': stroke, class: `gu-icon gu-icon-${name}${className ? ' ' + className : ''}` });
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); }
  else svg.setAttribute('aria-hidden', 'true');
  return svg;
}
/** replace every <i data-gu-icon="name"> under root with its SVG */
export function hydrateIcons(root = document) {
  for (const i of root.querySelectorAll('i[data-gu-icon]')) i.replaceWith(icon(i.dataset.guIcon, { size: Number(i.dataset.size) || 20, label: i.getAttribute('aria-label') || undefined }));
}
