/*
 * Gully Labs blog theme: interface behaviour. No dependencies, no network.
 *   1. Header menus (disclosure buttons; keyboard: Enter/Space/ArrowDown open, arrows move, Escape closes)
 *   2. Mobile sheet with accordions (focus trap, Escape, closes at desktop width)
 *   3. Links to other Gully sites in Ghost's navigation: new tab, rel, marker
 *   4. Reading progress hairline on posts
 *   5. Copy link and code blocks (with a toast)
 *   6. Content helpers: responsive embeds, scrollable tables
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
    var toast = document.querySelector('.gl-toast');
    var toastTimer = 0;
    function say(msg) {
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toast.classList.remove('is-on');
        }, 2200);
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
    document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-gl-copy]');
        if (!btn) return;
        copy(btn.getAttribute('data-gl-copy')).then(function () {
            say('Link copied');
        }, function () {
            say('Could not copy. Copy the address bar instead.');
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
                say('Code copied');
            }, function () {
                say('Could not copy the code');
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
})();
