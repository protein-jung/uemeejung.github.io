/* uemeejung.com 방문 통계 수집기.
 *
 * 보내는 것: 무엇을 눌렀고, 어느 구역을 얼마나 봤고, 언제 떠났는지.
 * 보내지 않는 것: 이름·이메일 같은 개인정보, 입력한 글자, 전체 referrer URL.
 * vid/sid 는 이 브라우저가 스스로 만든 난수이고 서버가 사람과 잇지 않는다.
 *
 * 수집 주소는 admin.uemeejung.com 이라 교차 출처다. 본문을 text/plain 으로
 * 보내 preflight 를 피한다 — sendBeacon 은 preflight 를 못 띄우므로, 떠나는
 * 순간의 이벤트가 여기에 달려 있다. 서버는 헤더와 무관하게 JSON 으로 읽는다. */
(function () {
  'use strict';

  var EP = 'https://admin.uemeejung.com/api/track';
  // 로컬에서 띄워 보는 동안 운영 통계를 더럽히지 않는다.
  if (!/(^|\.)uemeejung\.com$/.test(location.hostname)) return;

  function rnd() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function keep(store, key) {
    try {
      var v = store.getItem(key);
      if (!v) { v = rnd(); store.setItem(key, v); }
      return v;
    } catch (e) { return rnd(); }  // 사생활 보호 모드: 세션 한 번짜리로 센다
  }

  var vid = keep(localStorage, 'uj_vid');
  var sid = keep(sessionStorage, 'uj_sid');
  var device = matchMedia('(max-width:1000px)').matches ? 'mobile' : 'desktop';
  var path = location.pathname;
  var t0 = Date.now();
  var depth = 0;
  var lastSeen = '';
  var queue = [];
  var timer = null;
  var sent = false;

  function flush(beacon) {
    if (!queue.length) return;
    var body = JSON.stringify({ events: queue });
    queue = [];
    clearTimeout(timer); timer = null;
    try {
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(EP, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
        return;
      }
      fetch(EP, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  function send(e) {
    e.vid = vid; e.sid = sid; e.device = device;
    if (e.path === undefined) e.path = path;
    queue.push(e);
    if (queue.length >= 8) flush();
    else if (!timer) timer = setTimeout(flush, 8000);
  }

  /* ---------------- 접속 ---------------- */
  var ref = '';
  try { ref = document.referrer ? new URL(document.referrer).host : ''; } catch (e) {}
  if (ref === location.host) ref = '';     // 사이트 안에서의 이동은 유입이 아니다
  send({ type: 'pageview', ref: ref });

  /* ---------------- 클릭 ----------------
     누른 것의 이름을 고른다. data-track 이 있으면 그것이 정답이고, 없으면
     id, 그 다음 눈에 보이는 글자 순이다. 글자는 버튼이 바뀌면 같이 바뀌므로
     오래 남길 이름이 필요한 자리에는 data-track 을 달아 둔다. */
  function label(el) {
    if (el.getAttribute('data-track')) return el.getAttribute('data-track');
    if (el.id) return '#' + el.id;
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 60);
    var aria = el.getAttribute('aria-label');
    if (aria) return aria;
    return el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(/\s+/)[0] : '');
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target instanceof Element ? ev.target : null;
    var el = t && t.closest('a,button,[role="button"],label,.prj,.tab,.lt');
    if (!el) return;
    var href = el.getAttribute('href') || '';
    send({ type: 'click', label: label(el), href: href.slice(0, 200) });
    // 바깥으로 나가는 링크는 이 페이지가 곧 사라지므로 바로 보낸다.
    if (/^https?:/.test(href) && href.indexOf(location.host) < 0) flush();
  }, true);

  /* ---------------- 얼마나 내려갔나 ---------------- */
  var ticking = false;
  addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var h = document.documentElement.scrollHeight - innerHeight;
      var p = h > 0 ? Math.round((scrollY / h) * 100) : 100;
      if (p > depth) depth = Math.min(100, p);
    });
  }, { passive: true });

  /* ---------------- 어느 구역을 얼마나 봤나 ----------------
     화면에 들어온 순간부터 나간 순간까지를 구역별로 더한다. 떠날 때 한 번에
     보내므로, 스쳐 지나간 구역과 멈춰서 읽은 구역이 구분된다. */
  var seen = {};   // id -> 누적 ms
  var since = {};  // id -> 화면에 들어온 시각
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var id = en.target.id;
        if (!id) return;
        if (en.isIntersecting) {
          since[id] = Date.now();
          lastSeen = id;
        } else if (since[id]) {
          seen[id] = (seen[id] || 0) + (Date.now() - since[id]);
          delete since[id];
        }
      });
    }, { threshold: 0.35 });
    Array.prototype.forEach.call(document.querySelectorAll('section[id],header[id]'), function (s) {
      io.observe(s);
    });
  }

  /* ---------------- 떠남 ----------------
     pagehide 는 모바일에서 안 오는 경우가 있고 visibilitychange 는 탭만 바꿔도
     오므로 둘 다 듣되, sent 로 한 번만 보낸다.
     ponytail: 그래서 '머문 시간'은 처음 화면을 벗어난 순간까지다. 탭을 바꿨다가
     돌아와 더 읽은 시간은 빠진다. 그 차이가 문제가 될 만큼 트래픽이 붙으면
     visible 로 돌아올 때 다시 재서 exit 를 한 번 더 쌓는 쪽으로 바꾼다. */
  function leave() {
    if (sent) return;
    sent = true;
    Object.keys(since).forEach(function (id) {
      seen[id] = (seen[id] || 0) + (Date.now() - since[id]);
    });
    Object.keys(seen).forEach(function (id) {
      if (seen[id] >= 1000) send({ type: 'section', label: id, dwell: seen[id] });
    });
    send({ type: 'exit', label: lastSeen, dwell: Date.now() - t0, depth: depth });
    flush(true);
  }

  addEventListener('pagehide', leave);
  addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') leave();
  });
})();
