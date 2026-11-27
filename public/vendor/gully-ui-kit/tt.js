// Trusted Types: some vendor libraries (Tabulator, uPlot, zrender) write HTML strings into the DOM. A page that enforces
// Trusted Types calls installTrustedTypes() once at boot, before it mounts a component; it creates the 'default' policy:
// HTML is sanitised by DOMPurify, script URLs are allowed only for this kit's own folder, inline script is refused.
// CSP: require-trusted-types-for 'script'; trusted-types default dompurify <your own policies>
// A page that already has a default policy keeps it (returns false).
import { lazy } from './core.js';

const KIT = new URL('./', import.meta.url).href;
export async function installTrustedTypes() {
  const tt = typeof window !== 'undefined' && window.trustedTypes;
  if (!tt || tt.defaultPolicy) return false;
  const { default: purify } = await lazy('purify');
  tt.createPolicy('default', {
    createHTML: (s) => purify.sanitize(s, { RETURN_TRUSTED_TYPE: false }),
    createScriptURL: (u) => { const abs = new URL(u, location.href).href; if (abs.startsWith(KIT)) return abs; throw new TypeError('gully-ui-kit: script URL refused'); },
    createScript: () => { throw new TypeError('gully-ui-kit: inline script refused'); },
  });
  return true;
}
