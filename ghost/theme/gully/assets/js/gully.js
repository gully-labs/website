/*
 * Gully Labs blog theme: interface behaviour. No dependencies; the only network call is the stats ticker (7).
 *   1. Header menus (disclosure buttons; keyboard: Enter/Space/ArrowDown open, arrows move, Escape closes)
 *   2. Mobile sheet with accordions (focus trap, Escape, closes at desktop width)
 *   3. Links to other Gully sites in Ghost's navigation: new tab, rel, marker
 *   4. Reading progress hairline on posts
 *   5. Copy link and code blocks, with toasts (bottom-right stack, Lucide icon, cyan progress bar) on each real event
 *   6. Content helpers: responsive embeds, scrollable tables
 *   7. Live Gully stats ticker (gullylabs.xyz/api/stats): count-up numbers, continuous scroll, 30-day sparkline
 *   0. (first) Retires the old Ghost admin code-injection intro, so an empty blog shows the theme's one empty state
 */
(function () {
    'use strict';

    var WIDE = window.matchMedia('(min-width: 1024px)');
    var FINE = window.matchMedia('(hover: hover) and (pointer: fine)');

    /* ------------------------------------------- 0. old code-injection intro --- */
    /* Before this theme, Ghost admin > Code injection (site footer) added a "How we build" intro (section.gl-intro)
       and a stylesheet that restyles .gl-btn in the old palette. The theme has its own empty state: remove both.
       The owner should still clear that code injection; this only keeps a stale one from showing. */
    Array.prototype.forEach.call(document.querySelectorAll('section.gl-intro'), function (el) {
        el.parentNode.removeChild(el);
    });
    Array.prototype.forEach.call(document.querySelectorAll('style'), function (st) {
        if (st.textContent.indexOf('.gl-intro{') !== -1) st.parentNode.removeChild(st);
    });

    /* ---------------------------------------------------------------- 1. menus --- */
    var triggers = Array.prototype.slice.call(document.querySelectorAll('.gl-nav-trigger'));
    function panelOf(btn) {
        return document.getElementById(btn.getAttribute('aria-controls'));
    }
    function itemsOf(panel) {
        return Array.prototype.slice.call(panel.querySelectorAll('a[href], button:not([disabled])'));
    }
    function setMenu(btn, open) {
        var panel = panelOf(btn);
        if (!panel) return;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        panel.hidden = !open;
        btn.parentNode.classList.toggle('is-open', open);
    }
    function closeAll(except) {
        triggers.forEach(function (b) {
            if (b !== except) setMenu(b, false);
        });
    }
    triggers.forEach(function (btn) {
        var li = btn.parentNode;
        var panel = panelOf(btn);
        var hoverTimer = 0;
        btn.addEventListener('click', function () {
            var open = btn.getAttribute('aria-expanded') !== 'true';
            /* A click right after hover-open keeps the menu open (as on the site). */
            if (!open && Date.now() - (btn.__openedAt || 0) < 400) return;
            closeAll(btn);
            setMenu(btn, open);
            if (open) btn.__openedAt = Date.now();
        });
        btn.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                closeAll(btn);
                setMenu(btn, true);
                var first = itemsOf(panel)[0];
                if (first) first.focus();
            }
        });
        li.addEventListener('keydown', function (e) {
            var items = itemsOf(panel);
            var i = items.indexOf(document.activeElement);
            if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
                e.preventDefault();
                setMenu(btn, false);
                btn.focus();
            } else if (i >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                var next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
                items[next].focus();
            } else if (i >= 0 && (e.key === 'Home' || e.key === 'End')) {
                e.preventDefault();
                items[e.key === 'Home' ? 0 : items.length - 1].focus();
            }
        });
        li.addEventListener('focusout', function (e) {
            if (!li.contains(e.relatedTarget)) setMenu(btn, false);
        });
        li.addEventListener('pointerenter', function (e) {
            if (e.pointerType !== 'mouse' || !FINE.matches) return;
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(function () {
                if (btn.getAttribute('aria-expanded') !== 'true') {
                    closeAll(btn);
                    setMenu(btn, true);
                    btn.__openedAt = Date.now();
                }
            }, 120);
        });
        li.addEventListener('pointerleave', function (e) {
            if (e.pointerType !== 'mouse') return;
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(function () {
                if (!li.contains(document.activeElement)) setMenu(btn, false);
            }, 220);
        });
    });
    document.addEventListener('click', function (e) {
        if (!e.target.closest || !e.target.closest('.gl-nav-item')) closeAll();
    });

    /* ----------------------------------------------------------- 2. mobile sheet --- */
    var sheet = document.getElementById('gl-sheet');
    var opener = document.querySelector('[data-gl-sheet-open]');
    var lastOverflow = '';
    function focusables() {
        return Array.prototype.slice.call(sheet.querySelectorAll('a[href], button:not([disabled]), input')).filter(function (el) {
            return !el.closest('[hidden]') && el.offsetParent !== null;
        });
    }
    function openSheet() {
        sheet.hidden = false;
        opener.setAttribute('aria-expanded', 'true');
        lastOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.classList.add('gl-sheet-open');
        var close = sheet.querySelector('[data-gl-sheet-close]');
        requestAnimationFrame(function () {
            close.focus();
        });
    }
    function closeSheet(returnFocus) {
        if (sheet.hidden) return;
        sheet.hidden = true;
        opener.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = lastOverflow;
        document.documentElement.classList.remove('gl-sheet-open');
        if (returnFocus) opener.focus();
    }
    if (sheet && opener) {
        opener.addEventListener('click', openSheet);
        sheet.querySelector('[data-gl-sheet-close]').addEventListener('click', function () {
            closeSheet(true);
        });
        sheet.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeSheet(true);
                return;
            }
            if (e.key !== 'Tab') return;
            var f = focusables();
            if (!f.length) return;
            if (e.shiftKey && document.activeElement === f[0]) {
                e.preventDefault();
                f[f.length - 1].focus();
            } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
                e.preventDefault();
                f[0].focus();
            }
        });
        sheet.addEventListener('click', function (e) {
            var a = e.target.closest && e.target.closest('a[href], [data-ghost-search]');
            if (a && !a.matches('[target="_blank"]')) closeSheet(false);
        });
        var onWide = function () {
            if (WIDE.matches) closeSheet(false);
        };
        if (WIDE.addEventListener) WIDE.addEventListener('change', onWide);
        Array.prototype.forEach.call(sheet.querySelectorAll('.gl-acc-trigger'), function (btn, i) {
            var panel = document.getElementById(btn.getAttribute('aria-controls'));
            var set = function (open) {
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
                panel.hidden = !open;
            };
            if (i === 0) set(true); /* The blog's own sections start open. */
            btn.addEventListener('click', function () {
                set(btn.getAttribute('aria-expanded') !== 'true');
            });
        });
    }

    /* Retired Gully hosts that Ghost's own navigation (admin > Settings > Navigation) may still name: developers.
       has no DNS since 2026-10-17; the developer docs live on docs.gullylabs.xyz. Rewritten before the scan below. */
    var RETIRED = { 'developers.gullylabs.xyz': 'https://docs.gullylabs.xyz/' };
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
        var u;
        try {
            u = new URL(a.getAttribute('href'), location.href);
        } catch (err) {
            return;
        }
        if (RETIRED[u.hostname]) a.setAttribute('href', RETIRED[u.hostname]);
    });

    /* ------------------------------------------------- 3. links to other Gully sites --- */
    var GULLY = /(^|\.)gullylabs\.xyz$|^github\.com$|^x\.com$|^t\.me$/;
    Array.prototype.forEach.call(document.querySelectorAll('[data-gl-ext-scan] a[href]'), function (a) {
        var u;
        try {
            u = new URL(a.getAttribute('href'), location.href);
        } catch (err) {
            return;
        }
        if (u.host === location.host || !GULLY.test(u.hostname)) return;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        if (!a.querySelector('.gl-ext')) {
            a.insertAdjacentHTML('beforeend', '<span class="gl-ext" aria-hidden="true">↗</span><span class="gl-sr"> (opens in a new tab)</span>');
        }
    });

    /* Topic chips: mark the chip of the tag page you are on. */
    Array.prototype.forEach.call(document.querySelectorAll('[data-gl-chip]'), function (a) {
        var u;
        try {
            u = new URL(a.href, location.href);
        } catch (err) {
            return;
        }
        var here = location.pathname.replace(/page\/\d+\/?$/, '');
        if (u.pathname === here) {
            a.classList.add('is-current');
            a.setAttribute('aria-current', 'page');
        }
    });

    /* ----------------------------------------------------------- 4. reading progress --- */
    var bar = document.querySelector('.gl-progress-bar');
    var article = document.querySelector('.gl-content');
    if (bar && article) {
        var frame = 0;
        var paint = function () {
            frame = 0;
            var rect = article.getBoundingClientRect();
            var total = rect.height - window.innerHeight * 0.6;
            var done = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
            bar.style.transform = 'scaleX(' + done.toFixed(4) + ')';
        };
        var queue = function () {
            if (!frame) frame = requestAnimationFrame(paint);
        };
        paint();
        window.addEventListener('scroll', queue, {passive: true});
        window.addEventListener('resize', queue);
    }

    /* ------------------------------------------------------------ 5. copy + toast --- */
    /* Toasts: one element per event, stacked bottom right (newest at the bottom), a Lucide icon, a cyan progress bar
       that runs the toast's life (3.2 s; hover pauses it), click to dismiss. Only real events call say(). */
    var toasts = document.querySelector('[data-gl-toasts]');
    var ICON = {
        check: '<path d="M20 6 9 17l-5-5"/>',
        x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
        link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
        copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
    };
    function say(msg, kind, icon) {
        if (!toasts) return;
        var el = document.createElement('div');
        el.className = 'gl-toast gl-toast--' + (kind || 'info');
        el.innerHTML = '<svg class="gl-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            (ICON[icon || (kind === 'ok' ? 'check' : kind === 'error' ? 'x' : 'info')] || ICON.info) + '</svg>' +
            '<span class="gl-toast-text"></span><span class="gl-toast-bar" aria-hidden="true"></span>';
        el.querySelector('.gl-toast-text').textContent = msg;
        toasts.appendChild(el);
        while (toasts.children.length > 4) toasts.removeChild(toasts.firstChild);
        var gone = false;
        var remove = function () {
            if (gone) return;
            gone = true;
            el.classList.add('is-leaving');
            setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 220);
        };
        el.addEventListener('click', remove);
        el.querySelector('.gl-toast-bar').addEventListener('animationend', remove);
        /* No animation events with reduced motion (the bar is static): a plain timer then. */
        setTimeout(remove, 6000);
        requestAnimationFrame(function () {
            el.classList.add('is-on');
        });
    }
    function copy(text) {
        if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
        return new Promise(function (resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try {
                ok = document.execCommand('copy');
            } catch (err) {}
            document.body.removeChild(ta);
            if (ok) resolve();
            else reject(new Error('copy failed'));
        });
    }
    /* Subscribe: any Ghost members form (a signup card, a Portal-less embed) gets a toast when Ghost marks it
       success or error after the request. The theme itself has no opt-in; this covers forms in content. */
    Array.prototype.forEach.call(document.querySelectorAll('form[data-members-form]'), function (form) {
        if (!window.MutationObserver) return;
        var last = '';
        new MutationObserver(function () {
            var now = form.classList.contains('success') ? 'success' : form.classList.contains('error') ? 'error' : '';
            if (now === last) return;
            last = now;
            if (now === 'success') say('Subscribed. Check your inbox to confirm.', 'ok', 'check');
            else if (now === 'error') say('Could not subscribe. Try again in a moment.', 'error');
        }).observe(form, {attributes: true, attributeFilter: ['class']});
    });
    document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-gl-copy]');
        if (!btn) return;
        copy(btn.getAttribute('data-gl-copy')).then(function () {
            say(btn.getAttribute('data-gl-copy-msg') || 'Link copied', 'ok', 'link');
        }, function () {
            say('Could not copy. Copy the address bar instead.', 'error');
        });
    });

    /* Code blocks: a header with the language and a copy button. */
    Array.prototype.forEach.call(document.querySelectorAll('.gh-content pre'), function (pre) {
        if (pre.parentNode.classList.contains('gl-code')) return;
        var code = pre.querySelector('code');
        var lang = code && (code.className.match(/language-([\w+#-]+)/) || [])[1];
        var wrap = document.createElement('div');
        wrap.className = 'gl-code';
        pre.parentNode.insertBefore(wrap, pre);
        var head = document.createElement('div');
        head.className = 'gl-code-head';
        head.innerHTML = '<span class="gl-code-lang"></span><button type="button" class="gl-code-copy">Copy</button>';
        head.firstChild.textContent = lang ? lang.toUpperCase() : 'CODE';
        wrap.appendChild(head);
        wrap.appendChild(pre);
        pre.setAttribute('tabindex', '0');
        head.lastChild.setAttribute('aria-label', 'Copy code' + (lang ? ' (' + lang + ')' : ''));
        head.lastChild.addEventListener('click', function () {
            copy((code || pre).innerText).then(function () {
                say('Code copied', 'ok', 'copy');
            }, function () {
                say('Could not copy the code', 'error');
            });
        });
    });

    /* ------------------------------------------------------------ 6. content helpers --- */
    if (window.reframe) {
        window.reframe(document.querySelectorAll([
            '.gh-content iframe[src*="youtube.com"]',
            '.gh-content iframe[src*="youtube-nocookie.com"]',
            '.gh-content iframe[src*="player.vimeo.com"]',
            '.gh-content object',
            '.gh-content embed'
        ].join(',')));
    }
    Array.prototype.forEach.call(document.querySelectorAll('.gh-content > table'), function (table) {
        var wrap = document.createElement('div');
        wrap.className = 'gl-table';
        wrap.setAttribute('tabindex', '0');
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', 'Table (scrolls sideways)');
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
    });

    /* ------------------------------------------------------------- 7. live stats ticker --- */
    /* Reads gullylabs.xyz/api/stats (CORS open, cached 30 s there) every 60 s while the tab is visible. Numbers count
       up from the last value; the strip scrolls continuously (CSS, the list is cloned once the values are in); the
       sparkline is the last 30 days of volume. Reduced motion: values set directly, no scroll. Failures keep the
       last values (or the dashes) and the dot turns dim; nothing is toasted, it is not the reader's action. */
    var ticker = document.querySelector('[data-gl-ticker]');
    var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (ticker && window.fetch) {
        var list = ticker.querySelector('[data-gl-ticker-list]');
        var track = list.parentNode;
        var spark = ticker.querySelector('[data-gl-spark]');
        var updated = ticker.querySelector('[data-gl-ticker-updated]');
        var values = {};
        var cloned = false;
        var pill = document.querySelector('[data-gl-livepill]');
        var usd = function (n) {
            if (!isFinite(n)) return '—';
            var abs = Math.abs(n);
            var unit = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
            var v = n / unit[0];
            var digits = unit[1] ? (v < 10 ? 2 : v < 100 ? 1 : 0) : 0;
            return '$' + v.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + unit[1];
        };
        var setValue = function (el, to) {
            var key = el.getAttribute('data-stat');
            var from = values[key];
            values[key] = to;
            if (REDUCED.matches || from === undefined || from === to) {
                el.textContent = usd(to);
                return;
            }
            var start = performance.now();
            var step = function (now) {
                var k = Math.min(1, (now - start) / 900);
                var e = 1 - Math.pow(1 - k, 3);
                el.textContent = usd(from + (to - from) * e);
                if (k < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        };
        var drawSpark = function (daily) {
            if (!spark || !daily || daily.length < 2) return;
            var pts = daily.slice(-30).map(function (d) { return Math.max(0, +d.v || 0); });
            var max = Math.max.apply(null, pts) || 1;
            var w = 120, h = 28, pad = 2;
            var line = pts.map(function (v, i) {
                var x = pad + (i / (pts.length - 1)) * (w - pad * 2);
                var y = h - pad - (v / max) * (h - pad * 2);
                return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
            }).join(' ');
            spark.querySelector('.gl-spark-line').setAttribute('d', line);
            spark.querySelector('.gl-spark-fill').setAttribute('d', line + ' L' + (w - pad) + ' ' + (h - pad) + ' L' + pad + ' ' + (h - pad) + ' Z');
            spark.classList.add('is-drawn');
        };
        var apply = function (data) {
            var t = data && data.totals;
            if (!t) throw new Error('no totals');
            Array.prototype.forEach.call(list.querySelectorAll('[data-stat]'), function (el) {
                var v = t[el.getAttribute('data-stat')];
                if (typeof v === 'number') setValue(el, v);
            });
            drawSpark(data.daily);
            ticker.classList.add('is-live');
            ticker.classList.remove('is-stale');
            var d = data.generatedAt ? new Date(data.generatedAt) : new Date();
            if (updated) updated.textContent = 'as of ' + d.toUTCString().slice(17, 22) + ' UTC';
            if (pill) {
                pill.classList.add('is-live');
                var pt = pill.querySelector('[data-gl-live-time]');
                if (pt) pt.textContent = '· ' + d.toTimeString().slice(0, 8);
            }
            if (!cloned && !REDUCED.matches) {
                /* A second copy of the list makes the scroll seamless: when the first scrolls out, the clone is in place. */
                var copyList = list.cloneNode(true);
                copyList.setAttribute('aria-hidden', 'true');
                copyList.removeAttribute('data-gl-ticker-list');
                track.appendChild(copyList);
                track.classList.add('is-scrolling');
                cloned = true;
            }
        };
        var load = function () {
            if (document.hidden) return;
            fetch(ticker.getAttribute('data-src'), {mode: 'cors', credentials: 'omit', cache: 'default'})
                .then(function (r) {
                    if (!r.ok) throw new Error(String(r.status));
                    return r.json();
                })
                .then(apply)
                .catch(function () {
                    ticker.classList.add('is-stale');
                    if (pill) pill.classList.remove('is-live');
                });
        };
        load();
        setInterval(load, 60000);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) load();
        });
    }
})();
