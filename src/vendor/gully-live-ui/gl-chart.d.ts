// Types for the vendored gl-chart.js (Gully Live UI 1.0.0). The .js next to this file is a byte-identical copy.
export type GlPoint = [number, number]
export declare class GlChart extends HTMLElement {
  data: { series?: GlPoint[]; sampled?: GlPoint[]; activity?: GlPoint[]; loading?: boolean; activityLabel?: string }
  push(p: GlPoint): void
}
