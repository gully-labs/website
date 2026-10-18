# Kit recipes

One way to draw each common piece (design audit X4–X7, X10). Tokens live in `src/index.css`; charts in `src/components/charts/`.

## Components

| Component | File | Use |
|---|---|---|
| `StatusPill` | `ui/StatusPill.tsx` | `<StatusPill tone="live">Live</StatusPill>`. Tones: `ok`, `live` (blinking dot), `warn`, `error`, `up`, `down`, `neutral`, `off`. 22 px tall, mono 11 px. `pillClass(tone)` in `ui/pill.ts` gives the class string for a non-span element. |
| `Segmented` | `ui/Segmented.tsx` | `<Segmented label="Range" value={r} onChange={setR} options={[{ id: '7d', label: '7D' }, …]} />`. 44 px tall, chosen option gold. Built on `segGroup`/`segBtn` in `ui/seg.ts`. |
| `GhostChart` | `charts/GhostChart.tsx` | `<GhostChart height={150} label="Your payments will draw here" />`. The empty state for any chart; `variant` is `line`, `bars` or `ring`. |
| `ChartEmpty` | `charts/GhostChart.tsx` | `<ChartEmpty label="…" />` fills a positioned chart box. `EChart` and `LiveChart` show it on their own when there is nothing real to draw. |
| `GhostSpark` | `charts/GhostChart.tsx` | A ghosted mini trend for a KPI or table row with no data yet. |
| `MiniSpark` | `charts/MiniSpark.tsx` | `<MiniSpark data={values} label="Volume, 30 days" fmt={fmtUsd} />`. A small SVG trend line with a tooltip; null values leave gaps. |
| `MiniBars` | `charts/MiniBars.tsx` | `<MiniBars bars={[{ label, value }]} label="…" orientation="rows" />`. Small SVG bars as `columns` or `rows`; null is drawn as "not read". |

## Utilities (index.css)

| Class | What it sets |
|---|---|
| `card` | Surface fill, 1 px `line` border, radius `lg` (12). |
| `card-pad` | 20 px padding. Use it with `card`; leave it off for a full-bleed chart or table. |
| `heading-1` … `heading-4` | The whole heading recipe: display font, weight, uppercase, and the `text-h1`…`text-h4` size. |
| `eyebrow` | Mono 13 px, 1.5 px tracking, uppercase, gold. Add `text-faint` for a quiet section label. |
| `icon-sm` / `icon-md` / `icon-lg` / `icon-xl` | 14 inline / 16 controls / 20 tiles / 24 page. For lucide, `className="icon-md"` in place of `size={16}`. |
| `rounded-sm` / `md` / `lg` / `xl` | 6 / 8 / 12 / 16 px, from the kit handoff (button 6, card 16). |

`rounded-input`, `rounded-tile` and `rounded-card` are aliases for `sm`, `md` and `lg`. `rounded-btn` (4), `rounded-panel` (10) and `rounded-modal` (14) are off the scale and kept only until their pages move over.

## Chart colours

Use `C` and `PALETTE` from `charts/chartPresets` (defined in `charts/chartTheme.ts`). They mirror `--color-*` and `--color-chart-*` in `index.css`. Every chart gets the `gully` ECharts theme, so axis pointers, legends, data zoom, visual maps, brushes and tooltips are already in kit colours. `npm run test:chart-kit` fails if an ECharts default colour comes back.
