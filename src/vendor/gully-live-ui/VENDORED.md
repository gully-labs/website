# Vendored: Gully Live UI 1.0.2

`gl-core.js`, `gl-stat.js`, `gl-chart.js` and `README.md` are byte-identical copies of gully-ops
`sites/_shared/gully-live-ui/` at main 150f89a2 (git blob hashes match; `.gitattributes` keeps them `-text`). Never edit
them: update by copying the canonical files again. `*.d.ts` and this note are ours.

`tokens.css` is NOT loaded here: its `:root` block would overwrite the console's own `--gl-*` names
(src/console/console.css). The Gully Labs navy row (`.gl-kit-labs.gl-dark`, validated) is scoped to `.gl-live` in
src/components/live/gl-labs.css. React use: src/components/live/GlLive.tsx (LiveStat, LiveChart).
