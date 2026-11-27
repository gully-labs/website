// Three.js 3D hero: a slow wireframe form in the kit's own colours with a soft pointer parallax. Runs only on desktop-class
// devices (>= 900 px wide, 4+ GB memory, 4+ cores, WebGL) with motion allowed; everywhere else, and on any failure, the
// still (an image, or a token-coloured gradient from ui-kit.css) shows. Lazy: the chunk loads once the frame is near the
// viewport. Pauses off screen and in a hidden tab.
//   await mountHero3D(el, { still: '/brand/hero.png', alt: '', shape: 'knot' | 'ico', force: false })
import { lazy, prefs, inView, frame, tokens, onThemeChange, onResize, el as mk } from './core.js';

export async function mountHero3D(host, spec = {}) {
  const plot = frame(host, 'loading');
  host.classList.add('gu-hero3d');
  const still = () => {
    plot.replaceChildren();
    if (spec.still) { const img = mk('img'); img.src = spec.still; img.alt = spec.alt || ''; img.decoding = 'async'; plot.appendChild(img); }
    frame(host, 'ready'); host.dataset.guMode = 'still';
    return { mode: 'still', destroy() {} };
  };
  if (!(spec.force || prefs.capable3d())) return still();
  let T, renderer, scene, camera, group, raf = 0, visible = true, px = 0, py = 0;
  try { T = await new Promise((res, rej) => { inView(host, (on) => { if (on) { lazy('three').then(res, rej); } }); }); }
  catch { return still(); }
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch { return still(); }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  plot.replaceChildren(renderer.domElement);
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(40, 1, 0.1, 100); camera.position.z = 6;
  function paint() {
    const t = tokens(host);
    scene.clear();
    group = new T.Group();
    const geo = spec.shape === 'ico' ? new T.IcosahedronGeometry(1.7, 1) : new T.TorusKnotGeometry(1.2, 0.36, 160, 18);
    group.add(new T.LineSegments(new T.EdgesGeometry(geo, 12), new T.LineBasicMaterial({ color: new T.Color(t.series[0] || t.accent), transparent: true, opacity: 0.85 })));
    const pts = []; for (let i = 0; i < 260; i++) { const r = 2.6 + Math.random() * 1.4, a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1); pts.push(r * Math.sin(b) * Math.cos(a), r * Math.sin(b) * Math.sin(a), r * Math.cos(b)); }
    const pg = new T.BufferGeometry(); pg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    group.add(new T.Points(pg, new T.PointsMaterial({ color: new T.Color(t.series[1] || t.muted), size: 0.035, transparent: true, opacity: 0.7 })));
    scene.add(group);
  }
  function size() { const w = plot.clientWidth || host.clientWidth, h = plot.clientHeight || host.clientHeight || 320; renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function tick() {
    raf = 0;
    if (!visible || document.hidden || !prefs.motion()) return;
    group.rotation.y += 0.0022; group.rotation.x += 0.0009;
    group.position.x += (px * 0.25 - group.position.x) * 0.04; group.position.y += (-py * 0.18 - group.position.y) * 0.04;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  const go = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const move = (e) => { const r = host.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5; };
  const vis = () => { if (!document.hidden) go(); };
  paint(); size(); renderer.render(scene, camera); go();
  frame(host, 'ready'); host.dataset.guMode = 'motion';
  const stopView = inView(host, (on) => { visible = on; if (on) go(); }, { once: false, margin: '0px' });
  const offTheme = onThemeChange(() => { paint(); renderer.render(scene, camera); go(); });
  const offSize = onResize(host, () => { size(); renderer.render(scene, camera); });
  host.addEventListener('pointermove', move); document.addEventListener('visibilitychange', vis);
  return { mode: 'motion', destroy() { cancelAnimationFrame(raf); stopView(); offTheme(); offSize(); host.removeEventListener('pointermove', move); document.removeEventListener('visibilitychange', vis); renderer.dispose(); } };
}
