/*
 * Gully Labs blog: generated post banners.
 *
 * Every post gets a banner drawn from its own seed: the slug, the title and the primary tag's slug.
 * The same post always gets the same picture; two posts practically never look alike. Five motifs,
 * picked by the seed and leaning on the primary tag:
 *   lines   drifting chart lines over a hairline grid
 *   gap     a gold price line against a fair-value line, the band between them pulsing
 *   ticker  rows of the post's own words sliding past in mono, like a tape
 *   graph   blocks joined into a chain graph, pulses travelling along the links
 *   cells   a grid of cells lit by a slow diagonal wave
 * Brand colours on the dark background, the short title or the tag set in the corner.
 *
 * Runs in the browser (no dependencies, no network) and, for still share images, on a server with
 * any CanvasRenderingContext2D implementation: require() this file and call renderStill(). The
 * drawing code never touches the DOM. See ghost/README.md, "Share images".
 *
 * Browser behaviour: one canvas per [data-gl-banner], sized to its box (device pixels, capped).
 * Post and hero banners animate while on screen; card banners animate on hover or focus (and while
 * mostly in view on touch screens). Everything pauses off-screen (IntersectionObserver) and in
 * background tabs. With prefers-reduced-motion, or the theme's "Animated banners" setting off, each
 * banner is one still frame that fades in.
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.GullyBanner = api;
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.mount);
        else api.mount();
    }
})(this, function () {
    'use strict';

    var C = {
        bg: '#0b0e13',
        surface: '#10141a',
        line: '#1d232c',
        lineStrong: '#2c3540',
        lineHover: '#3a4452',
        ink: '#eef0f2',
        muted: '#a6b0bd',
        dim: '#8a96a6',
        gold: '#e8c060',
        goldHi: '#f4d98c',
        green: '#6fcf6a'
    };
    var FONT_DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
    var FONT_MONO = '"IBM Plex Mono", ui-monospace, monospace';
    var TAU = Math.PI * 2;

    /* ------------------------------------------------------------- seed --- */

    /** FNV-1a, 32 bit. */
    function hash(str) {
        var h = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    /** mulberry32: a small, fast, seedable PRNG returning [0, 1). */
    function rng(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) >>> 0;
            var t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    var MOTIFS = ['lines', 'gap', 'ticker', 'graph', 'cells'];
    /* The primary tag narrows the choice; the seed picks within it. First match wins. */
    var PREFS = [
        [/track|stock|gap|price|market|token|trad|swap/, ['gap', 'lines', 'ticker']],
        [/chain|infra|node|network|protocol|rollup|explorer|kit|bridge/, ['graph', 'cells', 'lines']],
        [/release|changelog|news|announce|update|ship|launch/, ['ticker', 'cells', 'graph']],
        [/analytic|data|metric|research|report/, ['lines', 'cells', 'gap']],
        [/pay|billing|payment|invoice/, ['graph', 'ticker', 'cells']],
        [/dev|api|sdk|engineer|code|guide|tutorial|widget|docs/, ['cells', 'graph', 'ticker']]
    ];

    /**
     * The seed string is slug + "\n" + title + "\n" + primary tag slug (missing parts are empty).
     * Everything below derives from hash(seedString) and nothing else.
     */
    function seedString(input) {
        return [input.seed || '', input.title || '', input.tag || ''].join('\n');
    }

    function spec(input) {
        var s = hash(seedString(input));
        var r = rng(s);
        var tag = (input.tag || '').toLowerCase();
        var pool = MOTIFS;
        for (var i = 0; i < PREFS.length; i++) {
            if (tag && PREFS[i][0].test(tag)) {
                pool = PREFS[i][1];
                break;
            }
        }
        var motif = pool[Math.floor(r() * pool.length)];
        return {
            seed: s,
            motif: motif,
            speed: 0.7 + r() * 0.7,
            grid: 28 + Math.floor(r() * 5) * 6,
            glowX: 0.45 + r() * 0.5,
            glowY: 0.1 + r() * 0.5,
            t0: (s % 997) / 31,
            code: 'GL-' + ('0000' + (s % 10000)).slice(-4),
            title: input.title || '',
            tagName: input.tagName || ''
        };
    }

    /** Up to five words and about 30 characters of the title, upper-cased. */
    function shortTitle(title) {
        var words = String(title || '').replace(/\s+/g, ' ').trim().split(' ');
        var out = [];
        for (var i = 0; i < words.length && out.length < 5; i++) {
            if ((out.join(' ') + ' ' + words[i]).length > 30 && out.length >= 2) break;
            out.push(words[i]);
        }
        var s = out.join(' ');
        if (out.length < words.length) s = s.replace(/[,.:;!?-]+$/, '') + '…';
        return s.toUpperCase();
    }

    function wrap(ctx, text, maxWidth, maxLines) {
        var words = text.split(' ');
        var lines = [];
        var cur = '';
        for (var i = 0; i < words.length; i++) {
            var next = cur ? cur + ' ' + words[i] : words[i];
            if (ctx.measureText(next).width > maxWidth && cur) {
                lines.push(cur);
                cur = words[i];
                if (lines.length === maxLines) break;
            } else cur = next;
        }
        if (lines.length < maxLines && cur) lines.push(cur);
        return lines.slice(0, maxLines);
    }

    function alpha(hex, a) {
        var n = parseInt(hex.slice(1), 16);
        return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }

    /** A periodic wave: a few sines with whole-number frequencies over period P (seamless drift). */
    function waveComps(r, n) {
        var comps = [];
        for (var i = 0; i < n; i++) comps.push({k: 1 + Math.floor(r() * (2 + i * 2)), a: 1 / (1 + i * 0.9), p: r() * TAU});
        var sum = 0;
        for (var j = 0; j < comps.length; j++) sum += comps[j].a;
        for (var m = 0; m < comps.length; m++) comps[m].a /= sum;
        return comps;
    }
    function wave(comps, x, P) {
        var v = 0;
        for (var i = 0; i < comps.length; i++) v += comps[i].a * Math.sin(TAU * comps[i].k * x / P + comps[i].p);
        return v;
    }
    function frac(x) {
        return x - Math.floor(x);
    }

    /* ----------------------------------------------------------- motifs --- */

    var BUILD = {
        lines: function (sp, w, h, r, small) {
            var n = small ? 2 : 3 + Math.floor(r() * 3);
            var lines = [];
            for (var i = 0; i < n; i++) {
                lines.push({
                    comps: waveComps(r, 4),
                    base: h * (0.32 + r() * 0.42),
                    amp: h * (0.1 + r() * 0.14),
                    v: (14 + r() * 22) * sp.speed * (i === 0 ? 1 : 0.6 + r() * 0.8),
                    dash: i > 0 && r() < 0.35
                });
            }
            return {lines: lines};
        },
        gap: function (sp, w, h, r) {
            return {
                fair: waveComps(r, 4),
                gap: waveComps(r, 3),
                base: h * (0.42 + r() * 0.16),
                amp: h * (0.14 + r() * 0.08),
                gapAmp: h * (0.07 + r() * 0.07),
                v: (16 + r() * 18) * sp.speed,
                now: 0.7 + r() * 0.15
            };
        },
        ticker: function (sp, w, h, r, small) {
            var words = (sp.title + ' ' + sp.tagName).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(function (x) {
                return x.length > 2;
            });
            if (words.length < 3) words = words.concat(['GULLY', 'LABS', 'BLOG', 'ONCHAIN']);
            var rowsN = Math.max(3, Math.min(small ? 3 : 7, Math.floor(h / 34)));
            var rows = [];
            var big = Math.floor(r() * rowsN);
            for (var i = 0; i < rowsN; i++) {
                var seq = [];
                for (var j = 0; j < 8; j++) seq.push(words[Math.floor(r() * words.length)]);
                var isBig = i === big && !small;
                rows.push({
                    text: seq.join(r() < 0.5 ? '  ◆  ' : '  /  ') + '  ◆  ',
                    big: isBig,
                    size: isBig ? Math.max(22, Math.min(64, h * 0.2)) : 11 + Math.floor(r() * 3),
                    v: (18 + r() * 34) * sp.speed * (i % 2 ? -1 : 1),
                    gold: i === (big + 1) % rowsN
                });
            }
            return {rows: rows};
        },
        graph: function (sp, w, h, r, small) {
            var k = Math.max(small ? 6 : 8, Math.min(small ? 9 : 22, Math.round((w * h) / 15000)));
            var nodes = [];
            for (var i = 0; i < k; i++) {
                var best = null;
                var bestD = -1;
                for (var c = 0; c < 12; c++) {
                    var p = {x: w * (0.06 + r() * 0.88), y: h * (0.12 + r() * 0.76)};
                    var d = Infinity;
                    for (var q = 0; q < nodes.length; q++) d = Math.min(d, Math.hypot(p.x - nodes[q].x, p.y - nodes[q].y));
                    if (d > bestD) {
                        bestD = d;
                        best = p;
                    }
                }
                best.ph = r() * TAU;
                best.size = 5 + Math.floor(r() * 4);
                nodes.push(best);
            }
            var edges = [];
            var seen = {};
            for (var a = 0; a < nodes.length; a++) {
                var near = nodes.map(function (n, idx) {
                    return {idx: idx, d: Math.hypot(n.x - nodes[a].x, n.y - nodes[a].y)};
                }).filter(function (x) {
                    return x.idx !== a;
                }).sort(function (x, y) {
                    return x.d - y.d;
                }).slice(0, 2);
                for (var b = 0; b < near.length; b++) {
                    var key = Math.min(a, near[b].idx) + '-' + Math.max(a, near[b].idx);
                    if (seen[key]) continue;
                    seen[key] = 1;
                    edges.push({a: a, b: near[b].idx, ph: r(), v: (0.12 + r() * 0.25) * sp.speed, pulse: r() < 0.6});
                }
            }
            return {nodes: nodes, edges: edges, hub: Math.floor(r() * nodes.length)};
        },
        cells: function (sp, w, h, r, small) {
            var size = small ? 10 : 16 + Math.floor(r() * 4) * 4;
            var gap = small ? 2 : 3;
            var theta = r() * TAU;
            var cols = Math.ceil(w / (size + gap)) + 1;
            var rows = Math.ceil(h / (size + gap)) + 1;
            /* Per-cell jitter and colour, fixed for the scene (not recomputed per frame). */
            var jitter = new Float32Array(cols * rows);
            var gold = new Uint8Array(cols * rows);
            for (var n = 0; n < cols * rows; n++) {
                jitter[n] = r() * 0.6;
                gold[n] = r() < 0.09 ? 1 : 0;
            }
            return {
                size: size,
                gap: gap,
                cols: cols,
                rows: rows,
                jitter: jitter,
                gold: gold,
                cos: Math.cos(theta),
                sin: Math.sin(theta),
                lambda: 90 + r() * 140,
                omega: (0.6 + r() * 0.6) * sp.speed
            };
        }
    };

    var DRAW = {
        lines: function (ctx, st, w, h, t) {
            for (var i = st.lines.length - 1; i >= 0; i--) {
                var L = st.lines[i];
                var off = t * L.v;
                ctx.beginPath();
                for (var x = 0; x <= w + 6; x += 6) {
                    var y = L.base + L.amp * wave(L.comps, x + off, w);
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                if (i === 0) {
                    ctx.save();
                    ctx.lineTo(w, h);
                    ctx.lineTo(0, h);
                    ctx.closePath();
                    var g = ctx.createLinearGradient(0, L.base - L.amp, 0, h);
                    g.addColorStop(0, alpha(C.gold, 0.16));
                    g.addColorStop(1, alpha(C.gold, 0));
                    ctx.fillStyle = g;
                    ctx.fill();
                    ctx.restore();
                    ctx.beginPath();
                    for (var x2 = 0; x2 <= w + 6; x2 += 6) {
                        var y2 = L.base + L.amp * wave(L.comps, x2 + off, w);
                        if (x2 === 0) ctx.moveTo(x2, y2);
                        else ctx.lineTo(x2, y2);
                    }
                    ctx.strokeStyle = C.gold;
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                    ctx.stroke();
                    var hx = w * 0.82;
                    var hy = L.base + L.amp * wave(L.comps, hx + off, w);
                    var pulse = frac(t * 0.6);
                    ctx.beginPath();
                    ctx.arc(hx, hy, 4 + pulse * 14, 0, TAU);
                    ctx.strokeStyle = alpha(C.gold, 0.5 * (1 - pulse));
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(hx, hy, 3.5, 0, TAU);
                    ctx.fillStyle = C.goldHi;
                    ctx.fill();
                } else {
                    ctx.strokeStyle = alpha(i % 2 ? C.muted : C.dim, 0.42);
                    ctx.lineWidth = 1.25;
                    ctx.setLineDash(L.dash ? [5, 5] : []);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        },
        gap: function (ctx, st, w, h, t) {
            var off = t * st.v;
            var fair = [];
            var price = [];
            for (var x = 0; x <= w + 6; x += 6) {
                var f = st.base + st.amp * wave(st.fair, x + off, w);
                fair.push([x, f]);
                price.push([x, f - st.gapAmp * (0.35 + 0.65 * wave(st.gap, x + off * 0.7, w))]);
            }
            ctx.beginPath();
            for (var i = 0; i < price.length; i++) ctx.lineTo(price[i][0], price[i][1]);
            for (var j = fair.length - 1; j >= 0; j--) ctx.lineTo(fair[j][0], fair[j][1]);
            ctx.closePath();
            ctx.fillStyle = alpha(C.gold, 0.1 + 0.07 * (0.5 + 0.5 * Math.sin(t * 1.3)));
            ctx.fill();
            ctx.beginPath();
            for (var a = 0; a < fair.length; a++) ctx.lineTo(fair[a][0], fair[a][1]);
            ctx.strokeStyle = alpha(C.muted, 0.6);
            ctx.lineWidth = 1.25;
            ctx.setLineDash([4, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            for (var b = 0; b < price.length; b++) ctx.lineTo(price[b][0], price[b][1]);
            ctx.strokeStyle = C.gold;
            ctx.lineWidth = 2;
            ctx.stroke();
            var nx = Math.round(w * st.now / 6) * 6;
            var idx = Math.min(fair.length - 1, nx / 6);
            ctx.beginPath();
            ctx.moveTo(nx + 0.5, 0);
            ctx.lineTo(nx + 0.5, h);
            ctx.strokeStyle = alpha(C.lineHover, 0.9);
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            var py = price[idx][1];
            var fy = fair[idx][1];
            ctx.beginPath();
            ctx.moveTo(nx + 8, py);
            ctx.lineTo(nx + 12, py);
            ctx.lineTo(nx + 12, fy);
            ctx.lineTo(nx + 8, fy);
            ctx.strokeStyle = C.gold;
            ctx.lineWidth = 1.25;
            ctx.stroke();
            ctx.fillStyle = C.goldHi;
            ctx.beginPath();
            ctx.arc(nx, py, 3.5, 0, TAU);
            ctx.fill();
            ctx.fillStyle = C.muted;
            ctx.beginPath();
            ctx.arc(nx, fy, 3, 0, TAU);
            ctx.fill();
            if (h > 90) {
                ctx.font = '500 10px ' + FONT_MONO;
                ctx.fillStyle = alpha(C.gold, 0.9);
                ctx.textBaseline = 'middle';
                ctx.fillText('GAP', nx + 17, (py + fy) / 2);
            }
        },
        ticker: function (ctx, st, w, h, t) {
            var rowH = h / st.rows.length;
            ctx.textBaseline = 'middle';
            for (var i = 0; i < st.rows.length; i++) {
                var R = st.rows[i];
                var y = rowH * (i + 0.5);
                ctx.font = (R.big ? '800 ' + R.size + 'px ' + FONT_DISPLAY : '500 ' + R.size + 'px ' + FONT_MONO);
                if (!R.width) R.width = ctx.measureText(R.text).width || 1;
                var x = -frac((t * R.v) / R.width) * R.width;
                ctx.fillStyle = R.big ? alpha(C.ink, 0.1) : R.gold ? alpha(C.gold, 0.85) : alpha(C.muted, 0.38);
                for (var xx = x; xx < w; xx += R.width) ctx.fillText(R.text, xx, y);
                if (i > 0) {
                    ctx.fillStyle = alpha(C.lineStrong, 0.7);
                    ctx.fillRect(0, Math.round(rowH * i), w, 1);
                }
            }
        },
        graph: function (ctx, st, w, h, t) {
            var N = st.nodes.map(function (n) {
                return {x: n.x, y: n.y + 2.5 * Math.sin(t * 0.8 + n.ph), size: n.size};
            });
            ctx.lineWidth = 1;
            for (var e = 0; e < st.edges.length; e++) {
                var E = st.edges[e];
                ctx.beginPath();
                ctx.moveTo(N[E.a].x, N[E.a].y);
                ctx.lineTo(N[E.b].x, N[E.b].y);
                ctx.strokeStyle = alpha(C.lineHover, 0.85);
                ctx.stroke();
            }
            for (var p = 0; p < st.edges.length; p++) {
                var P = st.edges[p];
                if (!P.pulse) continue;
                var k = frac(t * P.v + P.ph);
                var px = N[P.a].x + (N[P.b].x - N[P.a].x) * k;
                var py = N[P.a].y + (N[P.b].y - N[P.a].y) * k;
                ctx.fillStyle = alpha(C.gold, 0.25 + 0.75 * Math.sin(k * Math.PI));
                ctx.beginPath();
                ctx.arc(px, py, 2.2, 0, TAU);
                ctx.fill();
            }
            for (var i = 0; i < N.length; i++) {
                var n = N[i];
                var s = n.size;
                if (i === st.hub) {
                    var ring = frac(t * 0.45);
                    ctx.strokeStyle = alpha(C.gold, 0.55 * (1 - ring));
                    ctx.lineWidth = 1.25;
                    ctx.strokeRect(n.x - s - ring * 16, n.y - s - ring * 16, (s + ring * 16) * 2, (s + ring * 16) * 2);
                    ctx.fillStyle = C.gold;
                    ctx.fillRect(n.x - s, n.y - s, s * 2, s * 2);
                } else {
                    ctx.fillStyle = C.surface;
                    ctx.fillRect(n.x - s / 2, n.y - s / 2, s, s);
                    ctx.strokeStyle = alpha(C.muted, 0.6);
                    ctx.lineWidth = 1;
                    ctx.strokeRect(n.x - s / 2 + 0.5, n.y - s / 2 + 0.5, s - 1, s - 1);
                }
            }
        },
        cells: function (ctx, st, w, h, t) {
            var step = st.size + st.gap;
            for (var j = 0; j < st.rows; j++) {
                for (var i = 0; i < st.cols; i++) {
                    var n = j * st.cols + i;
                    var x = i * step;
                    var y = j * step;
                    var ph = (x * st.cos + y * st.sin) / st.lambda + st.jitter[n];
                    var v = Math.max(0, Math.sin(t * st.omega - ph * TAU * 0.5));
                    var lit = v * v * v * v * v * v;
                    var goldCell = st.gold[n] === 1;
                    ctx.fillStyle = goldCell ? alpha(C.gold, 0.1 + 0.75 * lit) : alpha(C.lineHover, 0.18 + 0.5 * lit);
                    ctx.fillRect(x, y, st.size, st.size);
                }
            }
        }
    };

    /* ------------------------------------------------------------ scene --- */

    /**
     * Builds a scene for one banner at one size. opts.variant: hero | post | card | tag | spark | share.
     * opts.hasImage: the banner sits over a feature image (draws a frame and a lower band only).
     */
    function createScene(input, w, h, opts) {
        opts = opts || {};
        var sp = spec(input);
        var small = opts.variant === 'spark';
        var st = BUILD[sp.motif](sp, w, h, rng(sp.seed ^ 0x9e3779b9), small);
        return {
            spec: sp,
            w: w,
            h: h,
            t0: sp.t0,
            draw: function (ctx, t) {
                drawScene(ctx, sp, st, w, h, t, opts);
            }
        };
    }

    function corners(ctx, w, h, inset, len, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        var pts = [[inset, inset, 1, 1], [w - inset, inset, -1, 1], [inset, h - inset, 1, -1], [w - inset, h - inset, -1, -1]];
        for (var i = 0; i < 4; i++) {
            var p = pts[i];
            ctx.beginPath();
            ctx.moveTo(p[0], p[1] + len * p[3]);
            ctx.lineTo(p[0], p[1]);
            ctx.lineTo(p[0] + len * p[2], p[1]);
            ctx.stroke();
        }
    }

    function drawScene(ctx, sp, st, w, h, t, opts) {
        var variant = opts.variant || 'post';
        var hasImage = !!opts.hasImage;
        ctx.save();
        ctx.clearRect(0, 0, w, h);

        if (!hasImage) {
            ctx.fillStyle = C.bg;
            ctx.fillRect(0, 0, w, h);
            var glow = ctx.createRadialGradient(w * sp.glowX, h * sp.glowY, 0, w * sp.glowX, h * sp.glowY, Math.max(w, h) * 0.7);
            glow.addColorStop(0, alpha(C.gold, 0.08));
            glow.addColorStop(1, alpha(C.gold, 0));
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, w, h);
            if (variant !== 'spark') {
                ctx.fillStyle = alpha(C.line, 0.9);
                for (var gx = sp.grid; gx < w; gx += sp.grid) ctx.fillRect(Math.round(gx), 0, 1, h);
                for (var gy = sp.grid; gy < h; gy += sp.grid) ctx.fillRect(0, Math.round(gy), w, 1);
            }
            DRAW[sp.motif](ctx, st, w, h, t);
        } else {
            /* Over a photo: the motif lives in the lower band only, fading out upwards, so the image
               stays fully visible; a gold frame of corner ticks marks the banner. */
            ctx.save();
            ctx.globalAlpha = 0.85;
            DRAW[sp.motif](ctx, st, w, h, t);
            ctx.restore();
            ctx.globalCompositeOperation = 'destination-in';
            var mask = ctx.createLinearGradient(0, 0, 0, h);
            mask.addColorStop(0, 'rgba(0,0,0,0)');
            mask.addColorStop(0.55, 'rgba(0,0,0,0)');
            mask.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = mask;
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';
        }

        if (variant === 'spark') {
            ctx.restore();
            return;
        }

        var pad = Math.max(14, Math.min(28, w * 0.035));
        corners(ctx, w, h, Math.round(pad * 0.5), Math.min(18, pad * 0.7), alpha(C.gold, hasImage ? 0.9 : 0.55));

        /* Kicker: tag (or GULLY LABS) and the banner's code, top left. */
        var kicker = (sp.tagName || 'Gully Labs').toUpperCase() + '  /  ' + sp.code;
        ctx.font = '500 ' + (variant === 'card' ? 10 : 11) + 'px ' + FONT_MONO;
        ctx.textBaseline = 'top';
        var kw = ctx.measureText(kicker).width;
        ctx.fillStyle = alpha(C.bg, hasImage ? 0.78 : 0.7);
        ctx.fillRect(pad - 6, pad - 5, kw + 12, 22);
        ctx.fillStyle = C.gold;
        ctx.fillText(kicker, pad, pad + 1);

        /* Big label, bottom left: the short title (hero, tag, share) or the tag (post, card). */
        if (!hasImage || variant === 'share') {
            var label = variant === 'post' || variant === 'card' ? (sp.tagName || shortTitle(sp.title) || 'GULLY LABS').toUpperCase() : shortTitle(sp.title) || 'GULLY LABS';
            var size = variant === 'card' ? Math.max(20, Math.min(34, h * 0.17)) : Math.max(26, Math.min(variant === 'share' ? 92 : 72, h * 0.17, w * 0.07));
            ctx.font = '800 ' + size + 'px ' + FONT_DISPLAY;
            var lines = wrap(ctx, label, w * (variant === 'card' ? 0.8 : 0.66), variant === 'card' ? 2 : 3);
            var lh = size * 0.98;
            var bottom = h - pad - (variant === 'share' ? 40 : 0);
            var scrim = ctx.createLinearGradient(0, bottom - lh * lines.length - pad, 0, h);
            scrim.addColorStop(0, alpha(C.bg, 0));
            scrim.addColorStop(0.5, alpha(C.bg, 0.6));
            scrim.addColorStop(1, alpha(C.bg, 0.85));
            ctx.fillStyle = scrim;
            ctx.fillRect(0, bottom - lh * lines.length - pad, w, h);
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = alpha(C.ink, 0.94);
            for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], pad, bottom - lh * (lines.length - 1 - i));
        }

        if (variant === 'share') {
            ctx.font = '800 30px ' + FONT_DISPLAY;
            ctx.textBaseline = 'alphabetic';
            var labsW = ctx.measureText('LABS').width;
            var gap = 8;
            var gullyW = ctx.measureText('GULLY').width;
            var x0 = w - pad - labsW - gap - gullyW;
            ctx.fillStyle = C.ink;
            ctx.fillText('GULLY', x0, h - pad);
            ctx.fillStyle = C.gold;
            ctx.fillText('LABS', x0 + gullyW + gap, h - pad);
            ctx.font = '500 14px ' + FONT_MONO;
            ctx.fillStyle = C.muted;
            ctx.fillText('BLOG.GULLYLABS.XYZ', pad, h - pad);
        }
        ctx.restore();
    }

    /** Draws the still frame (the same frame reduced motion shows) into a context of w by h. */
    function renderStill(ctx, input, w, h, opts) {
        var scene = createScene(input, w, h, opts);
        scene.draw(ctx, scene.t0);
        return scene;
    }

    /* -------------------------------------------------------------- DOM --- */

    var items = [];
    var running = false;
    var lastFrame = 0;

    function animationAllowed() {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        return !reduce && document.body.classList.contains('gl-animate');
    }

    function wantsMotion(it) {
        if (!it.visible || !animationAllowed()) return false;
        if (it.variant === 'card') return it.hover || (it.touch && it.ratio >= 0.6);
        return true;
    }

    function size(it) {
        var rect = it.el.getBoundingClientRect();
        var w = Math.max(1, Math.round(rect.width));
        var h = Math.max(1, Math.round(rect.height));
        var cap = it.variant === 'card' || it.variant === 'spark' ? 1.5 : 2;
        var dpr = Math.min(window.devicePixelRatio || 1, cap);
        if (w === it.w && h === it.h && dpr === it.dpr && it.scene) return;
        it.w = w;
        it.h = h;
        it.dpr = dpr;
        it.canvas.width = Math.round(w * dpr);
        it.canvas.height = Math.round(h * dpr);
        it.scene = createScene(it.input, w, h, {variant: it.variant, hasImage: it.hasImage});
        if (it.clock === null) it.clock = it.scene.t0;
        paint(it);
    }

    function paint(it) {
        if (!it.scene) return;
        it.ctx.setTransform(it.dpr, 0, 0, it.dpr, 0, 0);
        it.scene.draw(it.ctx, animationAllowed() ? it.clock : it.scene.t0);
        if (!it.ready) {
            it.ready = true;
            it.el.classList.add('is-drawn');
        }
    }

    function loop(now) {
        var dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
        lastFrame = now;
        var any = false;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (!wantsMotion(it)) continue;
            any = true;
            it.clock += dt;
            var fps = it.variant === 'card' || it.variant === 'spark' ? 24 : 30;
            if (now - it.last >= 1000 / fps - 2) {
                it.last = now;
                paint(it);
            }
        }
        if (any && !document.hidden) requestAnimationFrame(loop);
        else {
            running = false;
            lastFrame = 0;
        }
    }

    function kick() {
        if (running || document.hidden) return;
        for (var i = 0; i < items.length; i++) {
            if (wantsMotion(items[i])) {
                running = true;
                lastFrame = 0;
                requestAnimationFrame(loop);
                return;
            }
        }
    }

    function mount() {
        var els = document.querySelectorAll('[data-gl-banner]');
        if (!els.length || !document.createElement('canvas').getContext) return;
        var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
        var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                var it = en.target.__glBanner;
                it.visible = en.isIntersecting;
                it.ratio = en.intersectionRatio;
                if (it.visible && !it.scene) size(it);
            });
            kick();
        }, {rootMargin: '120px 0px', threshold: [0, 0.6]}) : null;
        var ro = 'ResizeObserver' in window ? new ResizeObserver(function (entries) {
            entries.forEach(function (en) {
                var it = en.target.__glBanner;
                if (it.scene || it.visible) size(it);
            });
        }) : null;

        Array.prototype.forEach.call(els, function (el) {
            if (el.__glBanner) return;
            var canvas = document.createElement('canvas');
            canvas.className = 'gl-banner-canvas';
            canvas.setAttribute('aria-hidden', 'true');
            el.appendChild(canvas);
            var it = {
                el: el,
                canvas: canvas,
                ctx: canvas.getContext('2d'),
                variant: el.getAttribute('data-variant') || 'post',
                hasImage: el.classList.contains('has-image'),
                input: {
                    seed: el.getAttribute('data-seed') || '',
                    title: el.getAttribute('data-title') || '',
                    tag: el.getAttribute('data-tag') || '',
                    tagName: el.getAttribute('data-tag-name') || ''
                },
                scene: null,
                clock: null,
                last: 0,
                visible: !io,
                ratio: io ? 0 : 1,
                hover: false,
                touch: touch,
                ready: false
            };
            el.__glBanner = it;
            items.push(it);
            var card = el.closest('[data-gl-card], .gl-strip-item');
            if (card && it.variant === 'card') {
                var on = function () {
                    it.hover = true;
                    kick();
                };
                var off = function () {
                    it.hover = false;
                };
                card.addEventListener('pointerenter', on);
                card.addEventListener('pointerleave', off);
                card.addEventListener('focusin', on);
                card.addEventListener('focusout', off);
            }
            if (io) io.observe(el);
            else size(it);
            if (ro) ro.observe(el);
        });

        document.addEventListener('visibilitychange', kick);
        if (window.matchMedia) {
            var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
            var repaint = function () {
                items.forEach(paint);
                kick();
            };
            if (mq.addEventListener) mq.addEventListener('change', repaint);
        }
        /* Text is drawn in the brand fonts: redraw once they have loaded. */
        if (document.fonts && document.fonts.load) {
            Promise.all([
                document.fonts.load('800 40px "Barlow Condensed"'),
                document.fonts.load('500 11px "IBM Plex Mono"')
            ]).then(function () {
                items.forEach(function (it) {
                    if (it.scene) {
                        it.scene = createScene(it.input, it.w, it.h, {variant: it.variant, hasImage: it.hasImage});
                        paint(it);
                    }
                });
            }).catch(function () {});
        }
        kick();
    }

    return {
        hash: hash,
        rng: rng,
        seedString: seedString,
        spec: spec,
        shortTitle: shortTitle,
        createScene: createScene,
        renderStill: renderStill,
        mount: mount,
        MOTIFS: MOTIFS
    };
});
