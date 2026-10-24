/* Uemee Jung — Portfolio client interactions.
 * Motion, canvases and controls recreated from the design handoff.
 * All page content is server-rendered; this file only adds behaviour. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ACC = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || 'oklch(0.86 0.14 190)';
  var INK = 'rgba(236,235,231,';

  /* ---------------- custom cursor ---------------- */
  (function cursor() {
    var cur = $('#cur');
    if (!cur || window.matchMedia('(hover:none)').matches) return;
    var mx = -100, my = -100, cx = -100, cy = -100;
    addEventListener('mousemove', function (e) { mx = e.clientX; my = e.clientY; }, { passive: true });
    document.addEventListener('mouseover', function (e) {
      var t = e.target instanceof Element ? e.target : null;
      cur.classList.toggle('big', !!(t && t.closest('a,button,.prj')));
    });
    (function loop() {
      cx += (mx - cx) * 0.2; cy += (my - cy) * 0.2;
      cur.style.transform = 'translate(' + cx + 'px,' + cy + 'px) translate(-50%,-50%)';
      requestAnimationFrame(loop);
    })();
  })();

  /* ---------------- nav state + mobile menu ---------------- */
  (function nav() {
    var navEl = $('#nav');
    if (!navEl) return;
    var links = $$('.nav-links a, .mnav-links a');
    var sections = $$('section[id]');
    var venture = $('#venture');
    var burger = $('#burger');
    var mnav = $('#mnav');

    addEventListener('scroll', function () {
      navEl.classList.toggle('scrolled', scrollY > 40);
      var cur = '';
      sections.forEach(function (s) {
        if (s.getBoundingClientRect().top < innerHeight * 0.4) cur = s.id;
      });
      links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + cur); });
      if (venture) {
        var v = venture.getBoundingClientRect();
        navEl.classList.toggle('light', v.top < 60 && v.bottom > 60);
      }
    }, { passive: true });

    /* The desktop list is hidden below 1000px, so the same links live in the
     * #mnav panel opened by #burger. Keep the body from scrolling behind it. */
    if (!burger || !mnav) return;

    // Park the panel flush against the real nav bottom instead of a guessed value.
    // The CSS fallback is only used before this runs.
    function syncNavHeight() {
      var h = navEl.getBoundingClientRect().height;
      if (h > 0) document.documentElement.style.setProperty('--navh', h + 'px');
    }
    syncNavHeight();
    addEventListener('resize', syncNavHeight, { passive: true });
    // Web fonts can change the nav height after first paint.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncNavHeight).catch(function () {});
    }

    function setMenu(open) {
      burger.classList.toggle('on', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      mnav.classList.toggle('open', open);
      navEl.classList.toggle('menu-open', open);
      // html as well as body: iOS Safari ignores a body-only overflow lock.
      document.documentElement.classList.toggle('menu-open', open);
      document.body.classList.toggle('menu-open', open);
      // Re-measure: the scrolled nav style changes the height slightly.
      syncNavHeight();
    }

    burger.addEventListener('click', function () {
      setMenu(!mnav.classList.contains('open'));
    });

    // Jumping to a section should leave the panel closed.
    $$('.mnav-links a').forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });

    addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setMenu(false);
    });

    // Widening past the breakpoint brings the desktop list back; drop the state.
    addEventListener('resize', function () {
      if (innerWidth > 1000) setMenu(false);
    });

    // Clicking outside the panel closes it.
    document.addEventListener('click', function (e) {
      if (!mnav.classList.contains('open')) return;
      var t = e.target instanceof Element ? e.target : null;
      if (t && (t.closest('#mnav') || t.closest('#burger'))) return;
      setMenu(false);
    });
  })();

  /* ---------------- scroll reveal + counters ---------------- */
  (function reveal() {
    var rvs = $$('.rv');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      rvs.forEach(function (el) { el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.12 });
      rvs.forEach(function (el) { io.observe(el); });
    }

    function countUp(el, to) {
      if (!el) return;
      if (reduceMotion) { el.textContent = to; return; }
      var start = null;
      var step = function (t) {
        if (!start) start = t;
        var k = Math.min(1, (t - start) / 1400);
        el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    var j = $('#cntJ'), c = $('#cntC');
    if (j && c) {
      var to = parseInt(j.getAttribute('data-count') || '0', 10);
      var tc = parseInt(c.getAttribute('data-count') || '0', 10);
      if (!('IntersectionObserver' in window)) { countUp(j, to); countUp(c, tc); return; }
      var cio = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { countUp(j, to); countUp(c, tc); cio.disconnect(); }
        });
      }, { threshold: 0.4 });
      cio.observe(j);
    }
  })();

  /* ---------------- hero EEG traces ---------------- */
  (function heroEEG() {
    var cv = $('#eeg');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var CH = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8', 'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2'];
    var W, H, dpr, visible = true;
    var hm = { x: -999, y: -999 }, sm = { x: -999, y: -999 };
    var seeds = CH.map(function () {
      return { f1: .6 + Math.random() * 1.4, f2: 3 + Math.random() * 6, f3: 9 + Math.random() * 12, p: Math.random() * 99, a: .6 + Math.random() * .6 };
    });
    function rs() {
      dpr = Math.min(2, devicePixelRatio || 1);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    rs();
    addEventListener('resize', rs);
    var host = cv.parentElement;
    host.addEventListener('mousemove', function (e) {
      var r = cv.getBoundingClientRect();
      hm.x = e.clientX - r.left; hm.y = e.clientY - r.top;
    });
    host.addEventListener('mouseleave', function () { hm.x = hm.y = -999; });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(cv);
    }

    function draw(t) {
      requestAnimationFrame(draw);
      if (!visible) { sm.x = hm.x; sm.y = hm.y; return; }
      if (cv.clientWidth !== W || cv.clientHeight !== H) rs();
      if (!W) return;
      t /= 1000;
      sm.x += (hm.x - sm.x) * .08; sm.y += (hm.y - sm.y) * .08;
      ctx.clearRect(0, 0, W, H);
      var top = H * .1, bot = H * .62, gap = (bot - top) / (CH.length - 1), left = 90;
      ctx.font = '10px Geist Mono, monospace';
      // time grid
      ctx.strokeStyle = 'rgba(236,235,231,.04)'; ctx.lineWidth = 1;
      var off = (t * 60) % 120;
      for (var gx = left - off; gx < W; gx += 120) {
        if (gx < left) continue;
        ctx.beginPath(); ctx.moveTo(gx, top - 20); ctx.lineTo(gx, bot + 20); ctx.stroke();
      }
      CH.forEach(function (c, i) {
        var s = seeds[i], y0 = top + i * gap;
        var near = Math.max(0, 1 - Math.abs(sm.y - y0) / 140);
        ctx.fillStyle = near > .3 ? ACC : 'rgba(141,143,142,.6)';
        ctx.fillText(c, 48, y0 + 3);
        ctx.beginPath();
        for (var x = left; x <= W; x += 3) {
          var u = x * .01 - t * 1.6;
          var v = Math.sin(u * s.f1 + s.p) * .5 + Math.sin(u * s.f2 * .4 + s.p * 2) * .3 + Math.sin(u * s.f3 * .25 + t * 3) * .15;
          var dx = x - sm.x, dy = y0 - sm.y, d = Math.sqrt(dx * dx + dy * dy);
          var g = Math.exp(-d * d / (2 * 110 * 110));
          v += g * (Math.sin(x * .12 - t * 14) * 2.6 + Math.sin(x * .31 + t * 9) * 1.2);
          var y = y0 + v * gap * .42 * s.a;
          if (x === left) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = near > .05
          ? 'color-mix(in oklch, ' + ACC + ' ' + Math.round(near * 100) + '%, rgba(236,235,231,.22))'
          : 'rgba(236,235,231,.22)';
        ctx.lineWidth = near > .3 ? 1.4 : 1;
        ctx.stroke();
      });
      // playhead
      var ph = left + ((t * 140) % (W - left));
      ctx.strokeStyle = ACC; ctx.globalAlpha = .35;
      ctx.beginPath(); ctx.moveTo(ph, top - 24); ctx.lineTo(ph, bot + 24); ctx.stroke();
      ctx.globalAlpha = 1;
      // fade bottom
      var gr = ctx.createLinearGradient(0, bot - 40, 0, bot + 80);
      gr.addColorStop(0, 'rgba(11,12,13,0)');
      gr.addColorStop(1, 'rgba(11,12,13,1)');
      ctx.fillStyle = gr; ctx.fillRect(0, bot - 40, W, H);
    }
    requestAnimationFrame(draw);
  })();

  /* ---------------- research interest canvases ---------------- */
  (function interests() {
    var cvs = $$('.int canvas');
    if (!cvs.length) return;
    var st = cvs.map(function (c) {
      return {
        c: c, ctx: c.getContext('2d'), hov: 0, on: true,
        pts: Array.from({ length: 60 }, function () {
          return { x: Math.random(), y: Math.random(), vx: (Math.random() - .5) * .002, vy: (Math.random() - .5) * .002 };
        })
      };
    });
    st.forEach(function (s) {
      s.c.parentElement.addEventListener('mouseenter', function () { s.hov = 1; });
      s.c.parentElement.addEventListener('mouseleave', function () { s.hov = 0; });
    });
    if ('IntersectionObserver' in window) {
      cvs.forEach(function (c, i) {
        new IntersectionObserver(function (es) { st[i].on = es[0].isIntersecting; }, { threshold: 0 }).observe(c);
      });
    }
    function frame(t) {
      requestAnimationFrame(frame);
      t /= 1000;
      st.forEach(function (s, k) {
        if (!s.on) return;
        var c = s.c, d = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
        if (!w) return;
        if (c.width !== Math.round(w * d)) { c.width = w * d; c.height = h * d; }
        var x = s.ctx;
        x.setTransform(d, 0, 0, d, 0, 0);
        x.clearRect(0, 0, w, h);
        s.h += (s.hov - s.h) * .06;
        var col = 'color-mix(in oklch, ' + ACC + ' ' + Math.round(s.h * 100) + '%, rgba(236,235,231,.55))';
        x.strokeStyle = col; x.fillStyle = col; x.lineWidth = 1;
        if (k === 0) {
          // brain rhythm bands
          for (var b = 0; b < 4; b++) {
            x.beginPath();
            for (var i = 0; i <= w; i += 2) {
              var y = h / 2 + (b - 1.5) * 22 + Math.sin(i * (.03 + b * .025) - t * (2 + b * 1.5 + s.h * 4)) * (6 + s.h * 8) * Math.sin(i / w * Math.PI);
              if (i) x.lineTo(i, y); else x.moveTo(i, y);
            }
            x.globalAlpha = .35 + b * .18;
            x.stroke();
          }
          x.globalAlpha = 1;
        } else if (k === 1) {
          // data nodes
          s.pts.forEach(function (p) {
            p.x += p.vx * (1 + s.h * 3); p.y += p.vy * (1 + s.h * 3);
            if (p.x < 0 || p.x > 1) p.vx *= -1;
            if (p.y < 0 || p.y > 1) p.vy *= -1;
          });
          for (var a = 0; a < s.pts.length; a++) {
            for (var b2 = a + 1; b2 < s.pts.length; b2++) {
              var pa = s.pts[a], pb = s.pts[b2];
              var ddx = (pa.x - pb.x) * w, ddy = (pa.y - pb.y) * h, dd = Math.hypot(ddx, ddy);
              if (dd < 46) {
                x.globalAlpha = (1 - dd / 46) * .5;
                x.beginPath(); x.moveTo(pa.x * w, pa.y * h); x.lineTo(pb.x * w, pb.y * h); x.stroke();
              }
            }
          }
          x.globalAlpha = 1;
          s.pts.forEach(function (p) { x.beginPath(); x.arc(p.x * w, p.y * h, 1.6, 0, 7); x.fill(); });
        } else {
          // perspective street grid
          var vx = w / 2 + Math.sin(t * .5) * 20 * s.h, vy = h * .42;
          x.globalAlpha = .6;
          for (var n = -8; n <= 8; n++) {
            x.beginPath(); x.moveTo(vx, vy); x.lineTo(w / 2 + n * w / 6, h); x.stroke();
          }
          for (var r = 0; r < 8; r++) {
            var z = ((r / 8) + t * (.08 + s.h * .2)) % 1;
            var yy = vy + (h - vy) * z * z;
            x.globalAlpha = z * .8;
            x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke();
          }
          x.globalAlpha = 1;
        }
      });
    }
    requestAnimationFrame(frame);
  })();

  /* ---------------- publications tabs ---------------- */
  (function pubs() {
    var tabs = $$('.tab');
    if (!tabs.length) return;
    var lists = { j: $('#pubJournal'), c: $('#pubConf') };
    tabs.forEach(function (b) {
      b.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        var t = b.getAttribute('data-t');
        if (lists.j) lists.j.hidden = t !== 'j';
        if (lists.c) lists.c.hidden = t !== 'c';
      });
    });
  })();

  /* ---------------- NeuroRoomie wordmark ---------------- */
  (function wordmark() {
    var w = $('#vWord');
    if (!w) return;
    function fit() {
      w.style.fontSize = '18vw';
      var pcs = getComputedStyle(w.parentElement);
      var cw = w.parentElement.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
      var sw = w.scrollWidth;
      if (sw > 0) w.style.fontSize = (parseFloat(getComputedStyle(w).fontSize) * cw / sw * .995) + 'px';
    }
    fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    addEventListener('resize', fit);
    if (!('IntersectionObserver' in window)) { w.classList.add('in'); return; }
    new IntersectionObserver(function (es, o) {
      es.forEach(function (e) { if (e.isIntersecting) { w.classList.add('in'); o.disconnect(); } });
    }, { threshold: .3 }).observe(w);
  })();

  /* ---------------- Space-BTI specimen ---------------- */
  (function bti() {
    var box = $('#vLetters');
    if (!box) return;
    var AX;
    try { AX = JSON.parse(box.getAttribute('data-axes')); } catch (e) { return; }
    if (!AX || !AX.length) return;
    var st = [1, 1, 1, 1];
    function render(k) {
      box.innerHTML = AX.map(function (a, i) {
        var on = st[i] ? 2 : 0, off = st[i] ? 0 : 2;
        return '<button class="lt' + (i === k ? ' flip' : '') + '" data-i="' + i + '" type="button" aria-pressed="' + (st[i] ? 'true' : 'false') + '">' +
          '<b>' + a[on] + '</b><span class="lbl">' + a[on + 1] + ' <i>/ ' + a[off + 1] + '</i></span></button>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.lt'), function (b) {
        b.addEventListener('click', function () {
          var i = +b.dataset.i;
          st[i] ^= 1;
          render(i);
        });
      });
    }
    render(-1);
    $$('.v-bti .q').forEach(function (q) {
      Array.prototype.forEach.call(q.querySelectorAll('label'), function (l) {
        l.addEventListener('click', function () {
          Array.prototype.forEach.call(q.querySelectorAll('label'), function (x) { x.classList.remove('on'); });
          l.classList.add('on');
          var parts = l.dataset.set.split(':').map(Number);
          st[parts[0]] = parts[1];
          render(parts[0]);
        });
      });
    });
  })();

  /* ---------------- NeuroRoomie mode switch ---------------- */
  (function mode() {
    var btn = $('#nrToggle');
    if (!btn) return;

    function setMode(on) {
      // The burger panel is hidden in NeuroRoomie mode; close it first so it
      // does not leave the scroll lock behind.
      var burger = $('#burger');
      if (burger && burger.classList.contains('on')) burger.click();
      document.body.classList.toggle('nr', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      // The wordmark fits itself to the container width and the canvases size
      // off clientWidth; both read 0 while the section is display:none, so they
      // have to measure again once it is on screen. Both already listen for
      // resize, and the nav theme/underline state is recomputed on scroll.
      dispatchEvent(new Event('resize'));
      dispatchEvent(new Event('scroll'));
      // The wordmark reveal is driven by an IntersectionObserver that cannot fire
      // for a display:none element, and once visible the line is wider than the
      // viewport, so the 0.3 threshold may never be met. Reveal it here instead —
      // the per-letter transition delays still play.
      var w = $('#vWord');
      if (on && w) w.classList.add('in');
    }

    btn.addEventListener('click', function () {
      var on = !document.body.classList.contains('nr');
      setMode(on);
      scrollTo(0, 0);
    });

    // In NeuroRoomie mode every other section is hidden, so an anchor pointing
    // at one would scroll nowhere. Leave the mode first, then let the browser
    // do the jump it was going to do anyway.
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('nr')) return;
      var t = e.target instanceof Element ? e.target : null;
      var a = t && t.closest('a[href^="#"]');
      if (!a || a.getAttribute('href') === '#venture') return;
      setMode(false);
    });
  })();

  /* ---------------- back to the top, without the hash ---------------- */
  (function toTop() {
    // The logo and the footer link are a way back up, not a destination, so
    // they should not leave #hero sitting in the address bar. The href stays
    // as it is: it is what works with JS off, and what the mode switch reads.
    document.addEventListener('click', function (e) {
      var t = e.target instanceof Element ? e.target : null;
      var a = t && t.closest('a[href="#hero"]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    });
  })();

  /* ---------------- email link (set by JS, as in the design) ---------------- */
  (function mail() {
    var m = document.getElementById('mailLink');
    if (!m) return;
    m.href = ['mai', 'lto:', 'junguemee', '\u0040', 'yonsei.ac.kr'].join('');
  })();
})();
