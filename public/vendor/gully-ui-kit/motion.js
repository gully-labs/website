// Motion wrappers (motion, MIT): enter on scroll, press feedback, count-up. Under reduced motion or Save-Data every
// element shows its final state at once; content is never hidden waiting for a script.
//   enter(document.querySelectorAll('.card'), { y: 12, stagger: 0.05 }) ; press(button) ; countUp(el, 1234.5, { format })
import { lazy, prefs, inView, fmtNum } from './core.js';

export function enter(els, { y = 12, duration = 0.45, stagger = 0.05 } = {}) {
  const list = [...(els.length != null ? els : [els])];
  if (!prefs.motion() || !list.length) return () => {};
  const stops = list.map((e, i) => inView(e, async (on) => {
    if (!on) return;
    const { animate } = await lazy('motion');
    animate(e, { opacity: [0, 1], transform: [`translateY(${y}px)`, 'translateY(0)'] }, { duration, delay: Math.min(i, 8) * stagger, ease: [0.2, 0.7, 0.2, 1] });
  }, { margin: '0px' }));
  return () => stops.forEach((s) => s());
}

export function press(target, { scale = 0.97 } = {}) {
  const down = async () => { if (!prefs.motion()) return; const { animate } = await lazy('motion'); animate(target, { transform: `scale(${scale})` }, { duration: 0.08 }); };
  const up = async () => { if (!prefs.motion()) return; const { animate } = await lazy('motion'); animate(target, { transform: 'scale(1)' }, { duration: 0.18 }); };
  target.addEventListener('pointerdown', down); target.addEventListener('pointerup', up); target.addEventListener('pointerleave', up);
  return () => { target.removeEventListener('pointerdown', down); target.removeEventListener('pointerup', up); target.removeEventListener('pointerleave', up); };
}

export async function countUp(target, to, { from = 0, duration = 0.9, format = fmtNum } = {}) {
  target.textContent = format(to);
  if (!prefs.motion() || !isFinite(to)) return;
  const { animate } = await lazy('motion');
  return animate(from, to, { duration, ease: [0.2, 0.7, 0.2, 1], onUpdate: (v) => { target.textContent = format(v); }, onComplete: () => { target.textContent = format(to); } });
}
