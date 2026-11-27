// Lottie wrapper (lottie-web light player: SVG renderer, no expressions, so no eval). Loads only when the frame is near the
// viewport, plays while visible, stops after `cycles` loops on its last frame. Reduced motion, Save-Data or a load
// failure show the still image instead.
//   await mountLottie(el, { src: '/brand/hello.json', still: '/brand/hello.png', alt: 'Swoop mascot waving', cycles: 3 })
import { lazy, prefs, inView, frame, el as mk } from './core.js';

export async function mountLottie(host, spec) {
  const plot = frame(host, 'loading');
  host.classList.add('gu-lottie');
  const still = () => {
    plot.replaceChildren();
    if (spec.still) { const img = mk('img'); img.src = spec.still; img.alt = spec.alt || ''; img.decoding = 'async'; plot.appendChild(img); }
    frame(host, 'ready'); host.dataset.guMode = 'still';
  };
  if (!prefs.motion()) { still(); return { mode: 'still', destroy() {} }; }
  let anim = null, loops = 0, stopView = () => {};
  await new Promise((resolve) => {
    stopView = inView(host, async (on) => {
      if (anim) { if (on && loops < (spec.cycles ?? 3)) anim.play(); else anim.pause(); return; }
      if (!on) return;
      try {
        const lottie = (await lazy('lottie')).default;
        anim = lottie.loadAnimation({ container: plot, renderer: 'svg', loop: true, autoplay: true, path: spec.src, rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true } });
        anim.addEventListener('loopComplete', () => { if (++loops >= (spec.cycles ?? 3)) { anim.goToAndStop(anim.totalFrames - 1, true); } });
        anim.addEventListener('DOMLoaded', () => { frame(host, 'ready'); host.dataset.guMode = 'motion'; resolve(); });
        anim.addEventListener('data_failed', () => { anim.destroy(); anim = null; still(); resolve(); });
      } catch { still(); resolve(); }
    }, { once: false, margin: '100px' });
    setTimeout(resolve, spec.waitMs ?? 4000);
  });
  return { get mode() { return host.dataset.guMode; }, get anim() { return anim; }, destroy() { stopView(); anim?.destroy(); } };
}
