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
    'gu-ink': '#FFFFFF', 'gu-ink-2': '#C9D2E8', 'gu-muted': '#A9B6D6', 'gu-surface': '#0E1C38', 'gu-surface-2': '#13254A', 'gu-line': '#3754A0', 'gu-grid': '#1B2C55',
    'gu-accent': '#6F8DDF', 'gu-on-accent': '#0E1C38', 'gu-series-1': '#6F8DDF', 'gu-series-2': '#E8573A', 'gu-series-3': '#1AA676', 'gu-series-4': '#C2861A', 'gu-series-5': '#8B67F0',
    'gu-up': '#2FD39A', 'gu-down': '#FF5C73', 'gu-warn': '#F5B547', 'gu-focus': '#6F8DDF', 'gu-shadow': '0 10px 30px rgba(0,0,0,.5)',
  },
  light: {
    bg: '#F1F3F8', hero1: '#FFFFFF', hero2: '#F1F3F8', hero3: '#E4E9F4', ink: '#FFFFFF', disc: '#0E1C38',
    surface: '#FFFFFF', surface2: '#F7F8FC', fg: '#0E1C38', soft: '#46557A',
    blue: '#CBD3E6', sky: '#3754A0', solid: '#0E1C38', 'on-solid': '#FFFFFF', hover: 'rgba(55,84,160,.10)',
    'chip-edge': 'rgba(14,28,56,.22)', sep: 'rgba(14,28,56,.24)', line: 'rgba(14,28,56,.12)',
    ok: '#3754A0', bad: '#B8321F', soon: '#46557A', lift: '0 1px 2px rgba(14,28,56,.05),0 10px 30px -12px rgba(14,28,56,.14)', 'toast-shadow': '0 8px 24px rgba(14,28,56,.18)',
    'gu-ink': '#0E1C38', 'gu-ink-2': '#33415F', 'gu-muted': '#46557A', 'gu-surface': '#FFFFFF', 'gu-surface-2': '#F1F3F8', 'gu-line': '#CBD3E6', 'gu-grid': '#E8ECF4',
    'gu-accent': '#3754A0', 'gu-on-accent': '#FFFFFF', 'gu-series-1': '#3754A0', 'gu-series-2': '#C2410C', 'gu-series-3': '#0E9F6E', 'gu-series-4': '#B26B00', 'gu-series-5': '#7B4DFF',
    'gu-up': '#0A8F66', 'gu-down': '#D3213F', 'gu-warn': '#B26B00', 'gu-focus': '#3754A0', 'gu-shadow': '0 10px 28px rgba(14,28,56,.14)',
  },
}
/** The pairs a page draws as text on a ground: [text token, ground token]. 4.5:1 or better in both themes. */
export const TEXT_PAIRS = [['fg', 'bg'], ['soft', 'bg'], ['sky', 'bg'], ['on-solid', 'solid'], ['bad', 'bg'], ['fg', 'hero2'], ['soft', 'hero2']]
const decl = (t) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';')
/** The :root rules: dark by default, light when the device asks for it, a saved choice over both. */
/** The Gully UI Kit 1.0.0 (gully-ops sites/_shared/gully-ui-kit, vendored byte-identical in public/vendor/gully-ui-kit) reads
 *  --gu-*: the Gully Labs set is above (light = the kit's own navy/blue defaults; dark from the kit file colours). */
export const GU_FONTS = '--gu-family:Figtree,system-ui,sans-serif;--gu-family-num:"IBM Plex Mono",ui-monospace,monospace;--gu-radius:14px'
export const TOKEN_CSS = `:root{color-scheme:dark;--ground:#F1F3F8;--navy:#0E1C38;${GU_FONTS};${decl(TOKENS.dark)}}`
  + `@media (prefers-color-scheme:light){:root:not([data-theme=dark]){color-scheme:light;${decl(TOKENS.light)}}}`
  + `:root[data-theme=light]{color-scheme:light;${decl(TOKENS.light)}}:root[data-theme=dark]{color-scheme:dark;${decl(TOKENS.dark)}}`
  // Logos: the reversed kit files on dark, the colour files on light (both byte-identical kit files).
  + `:root[data-theme=dark] .on-light,:root[data-theme=light] .on-dark{display:none!important}@media (prefers-color-scheme:dark){:root:not([data-theme]) .on-light{display:none!important}}@media (prefers-color-scheme:light){:root:not([data-theme]) .on-dark{display:none!important}}`
/** The blocking theme script (served as /landing/fx.js, before the first paint; the CSP refuses inline scripts). */
export const THEME_BOOT = "try{var t=localStorage.getItem('gl-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}"
  + "document.addEventListener('click',function(e){var b=e.target&&e.target.closest&&e.target.closest('[data-theme-toggle]');if(!b)return;var r=document.documentElement,c=r.getAttribute('data-theme'),n=c==='dark'?'light':c==='light'?'':'dark';if(n)r.setAttribute('data-theme',n);else r.removeAttribute('data-theme');try{n?localStorage.setItem('gl-theme',n):localStorage.removeItem('gl-theme')}catch(x){}var l=n==='dark'?'Dark':n==='light'?'Light':'System';b.setAttribute('aria-label','Theme: '+l+'. Change theme');var s=b.querySelector('[data-theme-word]');if(s)s.textContent=l})"
  + ";document.addEventListener('DOMContentLoaded',function(){var c=document.documentElement.getAttribute('data-theme'),l=c==='dark'?'Dark':c==='light'?'Light':'System';document.querySelectorAll('[data-theme-toggle]').forEach(function(b){b.setAttribute('aria-label','Theme: '+l+'. Change theme');var s=b.querySelector('[data-theme-word]');if(s)s.textContent=l})})"
