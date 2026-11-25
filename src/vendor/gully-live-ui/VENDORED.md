# Vendored: Gully Live UI 1.1.0

`gl-core.js`, `gl-stat.js` and `gl-chart.js` are byte-identical copies of gully-ops
`sites/_shared/gully-live-ui/` at main 6d2e890e (git blob hashes match: gl-core 82a4bdc0, gl-stat 5aa6a545,
gl-chart 75bd516c; README.md is the 1.0.4 copy; `.gitattributes` keeps them `-text`). Never edit them: update by copying the canonical files again.
`*.d.ts` and this note are ours. 1.0.4 adds `unit="percent"` on gl-stat (a plain share or fee rate, "0.3%", no sign;
`pct` stays the signed change). 1.1.0 adds the quiet unavailable state (a skeleton and one plain line). Re-vendored by
gully-ops stack/tools/propagate.mjs; the stack check (`npm run test:stack`) keeps them equal.

`tokens.css` is NOT loaded here: its `:root` block would overwrite the console's own `--gl-*` names
(src/console/console.css). The Gully Labs navy row (`.gl-kit-labs.gl-dark`, validated) is scoped to `.gl-live` in
src/components/live/gl-labs.css. React use: src/components/live/GlLive.tsx (LiveStat, LiveChart).
