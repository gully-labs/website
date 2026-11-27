// Gully UI Kit for React apps (no JSX needed). Each component mounts the vanilla wrapper into a div and destroys it on
// unmount; a new `spec` object updates it. Reserve the height with className/style (the frame never shifts the layout).
//   import { Chart, Live, Price, Table, Lottie, Hero3D, Icon } from './gully-ui-kit/react.js'
//   createElement(Chart, { spec: { option }, className: 'h-64' })
import { createElement, useEffect, useRef } from 'react';
import { mountChart } from './charts.js';
import { mountLive } from './live.js';
import { mountPrice } from './price.js';
import { mountTable } from './table.js';
import { mountLottie } from './lottie.js';
import { mountHero3D } from './hero3d.js';
import { icon } from './icons.js';

function adapter(mount, canUpdate) {
  return function GuComponent({ spec, className, style, onReady }) {
    const ref = useRef(null), handle = useRef(null), first = useRef(true);
    useEffect(() => {
      let dead = false;
      mount(ref.current, spec).then((h) => { if (dead) { h?.destroy?.(); return; } handle.current = h; onReady?.(h); });
      return () => { dead = true; handle.current?.destroy?.(); handle.current = null; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
      if (first.current) { first.current = false; return; }
      const h = handle.current; if (!h) return;
      if (canUpdate === 'update') h.update?.(spec); else if (canUpdate === 'set') h.set?.(spec.data);
    }, [spec]);
    return createElement('div', { ref, className, style });
  };
}
export const Chart = adapter(mountChart, 'update');
export const Live = adapter(mountLive, 'set');
export const Price = adapter(mountPrice, 'set');
export const Table = adapter(mountTable, 'set');
export const Lottie = adapter(mountLottie);
export const Hero3D = adapter(mountHero3D);
export function Icon({ name, size, label, className }) {
  const ref = useRef(null);
  useEffect(() => { const s = icon(name, { size, label, className }); ref.current.replaceChildren(s); }, [name, size, label, className]);
  return createElement('span', { ref, className: 'gu-icon-wrap' });
}
