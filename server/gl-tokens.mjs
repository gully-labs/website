// The Gully Labs token set (owner, 2026-11-26: one token set per product, defined once). Colours from the Gully Labs kit
// (Desktop\GRAPHICS\Gully Labs branding kit (1)\kit): navy #0E1C38, blue #3754A0, light blue #6F8DDF, ground #F1F3F8.
// Every server-drawn page (landing, /projects, product pages) reads these names and nothing else; the design reference
// (design/gullylabs-2026-11-26/index.html in gully-protocol) prints the same table. Text pairs are WCAG AA or better
// (scripts/test-gl-tokens.mjs checks them).
// Theme: no saved choice follows the device (System); a saved choice (localStorage gl-theme = dark | light) wins.
export const TOKENS = {
  dark: {
    bg: '#0E1C38', hero1: '#0E1C38', hero2: '#081226', hero3: '#060C1C', ink: '#060C1C', disc: '#060C1C',
    surface: 'rgba(111,141,223,.05)', surface2: 'rgba(111,141,223,.09)', fg: '#FFFFFF', soft: '#C9D2E8',
    blue: '#3754A0', sky: '#6F8DDF', solid: '#FFFFFF', 'on-solid': '#0E1C38', hover: 'rgba(55,84,160,.4)',
    'chip-edge': 'rgba(255,255,255,.22)', sep: 'rgba(255,255,255,.28)', line: 'rgba(201,210,232,.25)',
    ok: '#6F8DDF', bad: '#FF8A7A', soon: '#C9D2E8', lift: 'none', 'toast-shadow': '0 8px 24px rgba(0,0,0,.3)',
  },
  light: {
    bg: '#F1F3F8', hero1: '#FFFFFF', hero2: '#F1F3F8', hero3: '#E4E9F4', ink: '#FFFFFF', disc: '#0E1C38',
    surface: '#FFFFFF', surface2: '#F7F8FC', fg: '#0E1C38', soft: '#46557A',
    blue: '#CBD3E6', sky: '#3754A0', solid: '#0E1C38', 'on-solid': '#FFFFFF', hover: 'rgba(55,84,160,.10)',
    'chip-edge': 'rgba(14,28,56,.22)', sep: 'rgba(14,28,56,.24)', line: 'rgba(14,28,56,.12)',
    ok: '#3754A0', bad: '#B8321F', soon: '#46557A', lift: '0 1px 2px rgba(14,28,56,.05),0 10px 30px -12px rgba(14,28,56,.14)', 'toast-shadow': '0 8px 24px rgba(14,28,56,.18)',
  },
}
/** The pairs a page draws as text on a ground: [text token, ground token]. 4.5:1 or better in both themes. */
export const TEXT_PAIRS = [['fg', 'bg'], ['soft', 'bg'], ['sky', 'bg'], ['on-solid', 'solid'], ['bad', 'bg'], ['fg', 'hero2'], ['soft', 'hero2']]
const decl = (t) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';')
/** The :root rules: dark by default, light when the device asks for it, a saved choice over both. */
export const TOKEN_CSS = `:root{color-scheme:dark;--ground:#F1F3F8;--navy:#0E1C38;${decl(TOKENS.dark)}}`
  + `@media (prefers-color-scheme:light){:root:not([data-theme=dark]){color-scheme:light;${decl(TOKENS.light)}}}`
  + `:root[data-theme=light]{color-scheme:light;${decl(TOKENS.light)}}:root[data-theme=dark]{color-scheme:dark;${decl(TOKENS.dark)}}`
  // Logos: the reversed kit files on dark, the colour files on light (both byte-identical kit files).
  + `:root[data-theme=dark] .on-light,:root[data-theme=light] .on-dark{display:none!important}@media (prefers-color-scheme:dark){:root:not([data-theme]) .on-light{display:none!important}}@media (prefers-color-scheme:light){:root:not([data-theme]) .on-dark{display:none!important}}`
/** The blocking theme script (served as /landing/fx.js, before the first paint; the CSP refuses inline scripts). */
export const THEME_BOOT = "try{var t=localStorage.getItem('gl-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}"
  + "document.addEventListener('click',function(e){var b=e.target&&e.target.closest&&e.target.closest('[data-theme-toggle]');if(!b)return;var r=document.documentElement,c=r.getAttribute('data-theme'),n=c==='dark'?'light':c==='light'?'':'dark';if(n)r.setAttribute('data-theme',n);else r.removeAttribute('data-theme');try{n?localStorage.setItem('gl-theme',n):localStorage.removeItem('gl-theme')}catch(x){}var l=n==='dark'?'Dark':n==='light'?'Light':'System';b.setAttribute('aria-label','Theme: '+l+'. Change theme');var s=b.querySelector('[data-theme-word]');if(s)s.textContent=l})"
  + ";document.addEventListener('DOMContentLoaded',function(){var c=document.documentElement.getAttribute('data-theme'),l=c==='dark'?'Dark':c==='light'?'Light':'System';document.querySelectorAll('[data-theme-toggle]').forEach(function(b){b.setAttribute('aria-label','Theme: '+l+'. Change theme');var s=b.querySelector('[data-theme-word]');if(s)s.textContent=l})})"
