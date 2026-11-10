# Vendored: Gully Live UI 1.0.4

`gl-core.js`, `gl-stat.js`, `gl-chart.js` and `README.md` are byte-identical copies of gully-ops
`sites/_shared/gully-live-ui/` at main 8f4c34d4 (git blob hashes match: gl-core f6ef630d, gl-stat 415edb5f,
gl-chart c0f50c5e; `.gitattributes` keeps them `-text`). Never edit them: update by copying the canonical files again.
`*.d.ts` and this note are ours. 1.0.4 adds `unit="percent"` on gl-stat (a plain share or fee rate, "0.3%", no sign;
`pct` stays the signed change).

`tokens.css` is NOT loaded here: its `:root` block would overwrite the console's own `--gl-*` names
(src/console/console.css). The Gully Labs navy row (`.gl-kit-labs.gl-dark`, validated) is scoped to `.gl-live` in
src/components/live/gl-labs.css. React use: src/components/live/GlLive.tsx (LiveStat, LiveChart).
