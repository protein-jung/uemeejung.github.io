/* admin.uemeejung.com — 테스트 응답 수집 + 열람
   수집은 공개(테스트 페이지가 CORS 로 POST), 열람은 ADMIN_PW 로 잠근다. */

const SITE = "https://uemeejung.com";
const KINDS = { responses: "responses", contacts: "contacts", dropoff: "dropoff" };
const EVENT_TYPES = ["pageview", "click", "section", "exit"];

/* 수집기가 보내는 값은 바깥에서 온 것이므로 길이를 잘라 넣는다. */
const str = (v, max) => (v === undefined || v === null ? null : String(v).slice(0, max));
const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
const DAY = 86400;

const enc = (s) => new TextEncoder().encode(s);

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]));
}

async function issue(secret) {
  const exp = Math.floor(Date.now() / 1000) + 7 * DAY;
  return `${exp}.${await hmac(secret, String(exp))}`;
}

async function valid(secret, token) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return sig === (await hmac(secret, exp));
}

function cookie(req, name) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

/* 테스트 페이지는 uemeejung.com 에서 돌아가므로 그 출처만 허용한다. */
function cors(req) {
  const origin = req.headers.get("Origin");
  if (origin !== SITE) return {};
  return {
    "Access-Control-Allow-Origin": SITE,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

const json = (obj, init = {}) =>
  new Response(JSON.stringify(obj), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });

/* 재전송이 와도 응답ID 하나당 한 행만 남는다 (테스트 페이지의 flushLocal 이 미전송분을 다시 보낸다). */
async function store(env, kind, test, row) {
  const rid = row["응답ID"];
  if (!rid) return new Response("missing 응답ID", { status: 400 });
  await env.DB.prepare(
    `INSERT INTO ${KINDS[kind]} (rid, test, created_at, data) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(rid) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`
  )
    .bind(rid, test, new Date().toISOString(), JSON.stringify(row))
    .run();
  return new Response("ok");
}

/* 문항 번호(A1, B3 …)만 보여 주면 읽는 사람이 매번 질문지를 대조해야 한다.
   문안은 테스트 페이지가 이미 가지고 있으므로 거기서 읽어 온다 — 문안을 두 곳에 두면 언젠가 갈라진다.
   못 읽으면 번호로 그대로 보여 준다. */
let CFG = null;
async function config() {
  if (CFG) return CFG;
  try {
    const res = await fetch(`${SITE}/neuroroomie/1/`, { cf: { cacheTtl: 3600, cacheEverything: true } });
    const html = await res.text();
    const m = html.match(/<script type="application\/json" id="lf-config">([\s\S]*?)<\/script>/);
    CFG = JSON.parse(m[1]);
  } catch {
    CFG = {}; /* 빈 채로 둔다 */
  }
  CFG.items = CFG.items || [];
  CFG.axes = CFG.axes || [];
  CFG.types = CFG.types || {};
  return CFG;
}
async function labels() {
  const q = {};
  (await config()).items.forEach((it) => {
    if (it.id && it.text) q[it.id] = it.text;
  });
  return q;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => cols.includes(k) || cols.push(k)));
  const cell = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

async function rows(env, kind, test) {
  const q = test
    ? env.DB.prepare(`SELECT created_at, data FROM ${KINDS[kind]} WHERE test = ?1 ORDER BY created_at DESC`).bind(test)
    : env.DB.prepare(`SELECT created_at, data FROM ${KINDS[kind]} ORDER BY created_at DESC`);
  const { results } = await q.all();
  return results.map((r) => ({ 수집시각: r.created_at, ...JSON.parse(r.data) }));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

    /* 비밀번호가 설정되지 않았으면 열람 경로를 모두 닫는다 (빈 비밀번호로 통과되지 않도록). */
    const locked = !env.ADMIN_PW;
    if (locked && (p.startsWith("/api/admin/") || p === "/api/login")) {
      return json({ error: "ADMIN_PW secret not set" }, { status: 503 });
    }

    /* ---------- 방문 통계 수집 (공개) ----------
       본문이 text/plain 으로 온다 (preflight 없이 sendBeacon 으로 보내려고).
       req.json() 은 Content-Type 과 무관하게 파싱하므로 그대로 읽는다. */
    if (p === "/api/track" && req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response("bad json", { status: 400, headers: cors(req) });
      }
      const evs = (Array.isArray(body?.events) ? body.events : [])
        .slice(0, 50)
        .filter((e) => e && EVENT_TYPES.includes(e.type) && e.vid && e.sid);
      if (evs.length) {
        const now = new Date().toISOString();
        await env.DB.batch(
          evs.map((e) =>
            env.DB.prepare(
              `INSERT INTO events (ts, vid, sid, type, path, label, href, ref, device, dwell, depth)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
            ).bind(
              now,
              str(e.vid, 64),
              str(e.sid, 64),
              e.type,
              str(e.path, 200),
              str(e.label, 120),
              str(e.href, 200),
              str(e.ref, 120),
              e.device === "mobile" ? "mobile" : "desktop",
              int(e.dwell),
              int(e.depth)
            )
          )
        );
      }
      return new Response("ok", { headers: cors(req) });
    }

    /* ---------- 수집 (공개) ---------- */
    const collect = p.match(/^\/api\/(responses|contacts|dropoff)$/);
    if (collect && req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response("bad json", { status: 400, headers: cors(req) });
      }
      const res = await store(env, collect[1], url.searchParams.get("test") || "1", body);
      return new Response(res.body, { status: res.status, headers: cors(req) });
    }

    /* ---------- 로그인 ---------- */
    if (p === "/api/login" && req.method === "POST") {
      const { pw } = await req.json().catch(() => ({}));
      if (!pw) return json({ ok: false }, { status: 401 });
      /* 해시끼리 비교해 길이·접두사로 새어 나가지 않게 한다 */
      const ok = (await hmac(env.ADMIN_PW, "pw")) === (await hmac(String(pw), "pw"));
      if (!ok) return json({ ok: false }, { status: 401 });
      return json(
        { ok: true },
        {
          headers: {
            "Set-Cookie": `s=${await issue(env.ADMIN_PW)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * DAY}`,
          },
        }
      );
    }
    if (p === "/api/logout") {
      return json({ ok: true }, { headers: { "Set-Cookie": "s=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" } });
    }

    /* ---------- 열람 (로그인 필요) ---------- */
    if (p.startsWith("/api/admin/")) {
      if (!(await valid(env.ADMIN_PW, cookie(req, "s")))) return json({ error: "auth" }, { status: 401 });
      const test = url.searchParams.get("test") || "";
      const kind = p.split("/")[3];

      if (kind === "stats") {
        const [r, c, d] = await Promise.all(
          ["responses", "contacts", "dropoff"].map((k) =>
            env.DB.prepare(`SELECT COUNT(*) n FROM ${k}`).first("n")
          )
        );
        const durations = (await rows(env, "responses", test))
          .map((x) => Number(x.duration_sec))
          .filter((n) => n > 0);
        const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
        return json({ responses: r, contacts: c, dropoff: d, avgDurationSec: avg });
      }

      /* 사이트 통계: 한 번 눌러 한 화면을 채우므로 집계도 한 번에 모아 보낸다.
         각 질문이 SQL 한 줄이라 어디서 나온 숫자인지 읽으면 바로 보인다. */
      if (kind === "site") {
        const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") || "7", 10)));
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const one = (sql) => env.DB.prepare(sql).bind(since).first();
        const many = (sql) => env.DB.prepare(sql).bind(since).all().then((r) => r.results);

        const [sum, bounce, stay, clicks, sections, refs, exits, devices, daily, paths] = await Promise.all([
          one(`SELECT COUNT(DISTINCT sid) sessions, COUNT(DISTINCT vid) visitors,
                      SUM(type = 'pageview') pageviews, SUM(type = 'click') clicks
               FROM events WHERE ts >= ?1`),
          one(`SELECT COUNT(*) n FROM (
                 SELECT sid FROM events WHERE ts >= ?1 GROUP BY sid HAVING SUM(type = 'click') = 0)`),
          one(`SELECT AVG(dwell) avgDwell, AVG(depth) avgDepth, COUNT(*) n
               FROM events WHERE ts >= ?1 AND type = 'exit' AND dwell > 0`),
          many(`SELECT label, COUNT(*) n, COUNT(DISTINCT sid) sessions
                FROM events WHERE ts >= ?1 AND type = 'click'
                GROUP BY label ORDER BY n DESC LIMIT 40`),
          many(`SELECT label, COUNT(*) views, SUM(dwell) total, AVG(dwell) avg
                FROM events WHERE ts >= ?1 AND type = 'section'
                GROUP BY label ORDER BY total DESC`),
          many(`SELECT CASE WHEN ref IS NULL OR ref = '' THEN '(직접 방문)' ELSE ref END src, COUNT(*) n
                FROM events WHERE ts >= ?1 AND type = 'pageview'
                GROUP BY src ORDER BY n DESC LIMIT 20`),
          many(`SELECT CASE WHEN label IS NULL OR label = '' THEN '(기록 없음)' ELSE label END spot,
                       COUNT(*) n, AVG(dwell) avg, AVG(depth) depth
                FROM events WHERE ts >= ?1 AND type = 'exit'
                GROUP BY spot ORDER BY n DESC`),
          many(`SELECT device, COUNT(DISTINCT sid) n FROM events WHERE ts >= ?1 GROUP BY device`),
          many(`SELECT substr(ts, 1, 10) d, COUNT(DISTINCT sid) sessions, SUM(type = 'click') clicks
                FROM events WHERE ts >= ?1 GROUP BY d ORDER BY d`),
          many(`SELECT path, COUNT(*) n FROM events WHERE ts >= ?1 AND type = 'pageview'
                GROUP BY path ORDER BY n DESC LIMIT 10`),
        ]);

        return json({ days, sum, bounces: bounce.n, stay, clicks, sections, refs, exits, devices, daily, paths });
      }

      /* 테스트 결과 분석. 문항·축·유형 정의는 테스트 페이지의 lf-config 가 원본이고,
         성향 P = 축 5문항 평균(역문항 8−x) − 4 · 공간 S = 지각 2문항 평균 − 4 · 불일치 |P−S|
         는 그 페이지 lfScore 와 같은 식이다 (응답 수가 수백 단위라 JS 로 그냥 센다). */
      if (kind === "results") {
        const cfg = await config();
        const data = await rows(env, "responses", test || "1");
        const num = (v) => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
        const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
        const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);
        const col = (id) => data.map((r) => r[id]).filter((v) => v !== "" && v !== null && v !== undefined);
        const tally = (xs) => {
          const m = new Map();
          xs.forEach((v) => m.set(v, (m.get(v) || 0) + 1));
          return [...m].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
        };

        const axes = cfg.axes.map((ax) => {
          const Ps = [], Ss = [], gaps = [];
          let front = 0, back = 0;
          data.forEach((r) => {
            const vals = ax.items.map((id) => {
              const v = num(r[id]);
              return v === null ? null : ax.rev.indexOf(id) >= 0 ? 8 - v : v;
            });
            const P = vals.indexOf(null) >= 0 ? null : mean(vals) - 4;
            const pv = ax.perc.map((id) => num(r[id]));
            const S = pv.indexOf(null) >= 0 ? null : mean(pv) - 4;
            if (P !== null) {
              Ps.push(P);
              if (P > 0 || (P === 0 && r[ax.img] === "A")) front++; else back++;
            }
            if (S !== null) Ss.push(S);
            if (P !== null && S !== null) gaps.push(Math.abs(P - S));
          });
          return { name: `${ax.front} ↔ ${ax.back}`, note: ax.mismatch || "",
                   gap: r2(mean(gaps)), P: r2(mean(Ps)), S: r2(mean(Ss)),
                   front, back, frontName: ax.front, backName: ax.back };
        });

        /* 만족도 = D1,D2,D7,(8−D8) 평균 */
        const sat = data
          .map((r) => {
            const v = ["D1", "D2", "D7", "D8"].map((k) => num(r[k]));
            return v.indexOf(null) >= 0 ? null : (v[0] + v[1] + v[2] + (8 - v[3])) / 4;
          })
          .filter((v) => v !== null);

        const DIST = ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "C12", "E1", "E3", "F3"];
        return json({
          n: data.length,
          avgFit: r2(mean(col("궁합").map(Number))),
          avgSat: r2(mean(sat)),
          avgDur: Math.round(mean(col("duration_sec").map(Number)) || 0),
          types: tally(col("유형")).map((t) => ({ ...t, name: (cfg.types[t.k] || {}).name || "" })),
          axes,
          dists: DIST.map((id) => ({
            id,
            text: (cfg.items.filter((it) => it.id === id)[0] || {}).text || id,
            rows: tally(col(id)),
          })),
          comments: data
            .filter((r) => String(r.F2 || "").trim())
            .map((r) => ({ type: r["유형"] || "", fit: r["궁합"], text: r.F2, agree: r.F1 })),
          daily: tally(data.map((r) => String(r.수집시각 || "").slice(0, 10))).sort((a, b) => (a.k < b.k ? -1 : 1)),
          utm: tally(data.map((r) => r.utm_source || "(직접 접속)")),
          device: tally(data.map((r) => (/Mobi|Android|iPhone|iPad/.test(r.user_agent || "") ? "모바일" : "데스크톱"))),
        });
      }

      if (kind === "labels") return json(await labels());

      if (KINDS[kind]) {
        const data = await rows(env, kind, test);
        if (url.searchParams.get("format") === "csv") {
          return new Response(toCsv(data), {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="uemee_${kind}_${new Date().toISOString().slice(0, 10)}.csv"`,
            },
          });
        }
        return json(data);
      }
      return json({ error: "unknown" }, { status: 404 });
    }

    /* ---------- 관리 화면 ---------- */
    if (p === "/" || p === "/index.html") {
      return new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
      });
    }
    return new Response("not found", { status: 404 });
  },
};

const PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>uemeejung 관리자</title>
<style>
 :root { --ink:#16161a; --line:#e3e1dc; --bg:#f7f5f1; --accent:#3451E8; }
 *{box-sizing:border-box} body{margin:0;font:14px/1.5 -apple-system,"Apple SD Gothic Neo","Pretendard",sans-serif;color:var(--ink);background:var(--bg)}
 #login{max-width:320px;margin:18vh auto;padding:28px;background:#fff;border:1px solid var(--line);border-radius:12px}
 input,button{font:inherit}
 input{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;margin-top:10px}
 .pwrow{position:relative;margin-top:10px}
 .pwrow input{margin-top:0;padding-right:42px}
 .pweye{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;padding:8px;line-height:0;color:#8a8880}
 .pweye:hover{color:var(--ink)}
 .pweye .slash{display:none}
 .pweye[aria-pressed="true"] .slash{display:inline}
 button{padding:10px 14px;border:0;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer}
 #shell{display:none;grid-template-columns:200px 1fr;min-height:100vh}
 nav{background:#fff;border-right:1px solid var(--line);padding:20px 0}
 nav h1{font-size:14px;margin:0 20px 16px;letter-spacing:-.02em}
 nav a{display:block;padding:9px 20px;color:var(--ink);text-decoration:none;cursor:pointer}
 nav a.on{background:var(--bg);font-weight:600;box-shadow:inset 3px 0 var(--accent)}
 nav #out{color:#777;margin-top:20px}
 main{padding:28px 32px;overflow:auto}
 h2{margin:0 0 4px;font-size:20px} .sub{color:#777;margin:0 0 20px}
 .cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}
 .card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 20px;min-width:140px}
 .card b{display:block;font-size:26px;letter-spacing:-.03em}
 .card span{color:#777;font-size:12px}
 .bar{display:flex;gap:8px;align-items:center;margin-bottom:12px}
 .wrap{overflow:auto;background:#fff;border:1px solid var(--line);border-radius:10px;max-height:70vh}
 table{border-collapse:collapse;white-space:nowrap;font-size:12.5px}
 th,td{border-bottom:1px solid var(--line);padding:7px 10px;text-align:left}
 th{position:sticky;top:0;background:#fff;font-weight:600}
 .ghost{background:#fff;color:var(--ink);border:1px solid var(--line)}
 tr.pick{cursor:pointer} tr.pick:hover td{background:#f3f6ff}
 th.lead,td.lead{background:#fbfaf8}
 .detail{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 20px;margin-bottom:14px}
 .range{display:flex;gap:6px;margin-bottom:18px}
 .range button{background:#fff;color:#777;border:1px solid var(--line);padding:6px 12px;font-size:12.5px}
 .range button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
 .panel{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 20px;margin-bottom:16px}
 .panel h3{margin:0 0 2px;font-size:15px}
 .panel .note{color:#777;font-size:12px;margin:0 0 12px}
 .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;align-items:start}
 .rank{width:100%;border-collapse:collapse;font-size:13px;white-space:normal}
 .rank td{border:0;padding:5px 0;vertical-align:middle}
 .rank td.k{width:100%;overflow-wrap:anywhere}
 .rank td.v{text-align:right;white-space:nowrap;padding-left:14px;color:#555}
 .meter{height:5px;border-radius:3px;background:var(--accent);opacity:.75;margin-top:3px;min-width:2px}
 .detail dl{display:grid;grid-template-columns:220px 1fr;gap:2px 16px;margin:12px 0 0;font-size:13px}
 .detail dt{color:#777;overflow-wrap:anywhere}
 .detail dd{margin:0;overflow-wrap:anywhere}
 /* 폰: 200px 사이드바가 화면의 절반을 먹어 본문이 한 글자씩 접혔다.
    메뉴를 가로 탭 줄로 눕히고 본문에 폭을 전부 넘긴다. */
 @media (max-width:760px){
   #shell{grid-template-columns:1fr}
   nav{display:flex;align-items:center;gap:0;padding:0;overflow-x:auto;
       border-right:0;border-bottom:1px solid var(--line);
       position:sticky;top:0;z-index:5;-webkit-overflow-scrolling:touch}
   nav h1{margin:0 2px 0 16px;flex:none}
   nav a{flex:none;white-space:nowrap;padding:14px 12px}
   nav a.on{background:transparent;box-shadow:inset 0 -3px var(--accent)}
   nav #out{margin:0 16px 0 auto}
   main{padding:18px 16px}
   #login{margin:10vh 16px;max-width:none}
   .cards{display:grid;grid-template-columns:1fr 1fr;gap:8px}
   .card{min-width:0;padding:12px 14px}
   .card b{font-size:22px}
   .grid2{grid-template-columns:1fr}
   .panel{padding:14px 16px}
   .range{flex-wrap:wrap}
   .rank td.k{overflow-wrap:break-word}
   .rank td.v{padding-left:10px;font-size:12px}
   .detail dl{grid-template-columns:1fr;gap:0}
   .detail dt{margin-top:12px}
 }
</style></head><body>
<div id="login">
  <div style="font-weight:700">uemeejung 관리자</div>
  <div class="pwrow">
    <input id="pw" type="password" placeholder="비밀번호" autocomplete="current-password">
    <button type="button" class="pweye" id="pweye" aria-pressed="false" aria-label="비밀번호 보기">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
        <path d="M1.9 12S5.6 5.6 12 5.6 22.1 12 22.1 12 18.4 18.4 12 18.4 1.9 12 1.9 12Z"/>
        <circle cx="12" cy="12" r="3.1"/>
        <line class="slash" x1="4.2" y1="19.8" x2="19.8" y2="4.2"/>
      </svg>
    </button>
  </div>
  <button style="width:100%;margin-top:10px" id="go">들어가기</button>
  <p id="err" style="color:#b02a2a;font-size:12px;display:none">비밀번호가 맞지 않습니다</p>
</div>
<div id="shell">
  <nav>
    <h1>uemeejung</h1>
    <a data-v="stats">개요</a>
    <a data-v="site">사이트 통계</a>
    <a data-v="results">테스트 결과 분석</a>
    <a data-v="responses">응답 원본</a>
    <a data-v="contacts">인터뷰 연락처</a>
    <a data-v="dropoff">중간 이탈</a>
    <a id="out">로그아웃</a>
  </nav>
  <main id="main"></main>
</div>
<script>
var M = document.getElementById("main");
var TITLE = { stats:["개요","수집 현황"], site:["사이트 통계","uemeejung.com 방문자가 무엇을 보고 눌렀는지"], results:["테스트 결과 분석","공간 궁합 테스트 — 유형·궁합·축별 불일치"], responses:["응답 원본","/neuroroomie/1/ 완료 응답 전체"], contacts:["인터뷰 연락처","심층 인터뷰에 동의한 분"], dropoff:["중간 이탈","끝까지 가지 않은 기록"] };

function api(path){ return fetch("/api/admin/" + path, { credentials:"same-origin" }).then(function(r){
  if (r.status === 401) { show(false); throw new Error("auth"); }
  return r.json();
}); }

function esc(s){ return String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, function(c){ return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]; }); }

/* 한 응답에 문항이 50개 넘어가서 전부 기둥으로 펼치면 읽힐 표가 아니다.
   알아볼 수 있는 칸 몇 개만 앞에 세우고, 나머지는 줄을 눌렀을 때 아래에 펼친다. */
var LEAD = ["수집시각", "응답ID", "유형", "궁합", "duration_sec", "마지막문항"];
var HEAD = { duration_sec: "소요(초)" };
var LBL = {};
var LAST = [];

function fmt(c, v){
  if (v === undefined || v === null || v === "") return "";
  if (c === "수집시각") return String(v).replace("T", " ").slice(0, 16);
  if (c === "duration_sec") return Math.floor(v / 60) + "분 " + (v % 60) + "초";
  return v;
}

function table(rows){
  if (!rows.length) return '<p class="sub">아직 수집된 데이터가 없습니다.</p>';
  LAST = rows;
  var rest = [];
  rows.forEach(function(r){
    Object.keys(r).forEach(function(k){ if (LEAD.indexOf(k) < 0 && rest.indexOf(k) < 0) rest.push(k); });
  });
  var lead = LEAD.filter(function(c){ return rows.some(function(r){ return r[c] !== undefined; }); });
  var cols = lead.concat(rest);
  return '<p class="sub">줄을 누르면 그 응답의 모든 문항을 위에서 펼쳐 보여줍니다.</p>'
    + '<div id="detail"></div>'
    + '<div class="wrap"><table><thead><tr>'
    + cols.map(function(c, i){ return '<th' + (i < lead.length ? ' class="lead"' : "")
        + (LBL[c] ? ' title="' + esc(LBL[c]) + '"' : "") + ">" + esc(HEAD[c] || c) + "</th>"; }).join("")
    + "</tr></thead><tbody>" + rows.map(function(r, i){
        return '<tr class="pick" data-i="' + i + '">' + cols.map(function(c, j){
          return "<td" + (j < lead.length ? ' class="lead"' : "") + ">" + esc(fmt(c, r[c])) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
}

function detail(i){
  var r = LAST[i];
  if (!r) return;
  document.getElementById("detail").innerHTML = '<div class="detail"><button class="ghost" id="dclose">닫기</button><dl>'
    + Object.keys(r).map(function(k){
        var name = LBL[k] ? k + ". " + LBL[k] : HEAD[k] || k;
        return "<dt>" + esc(name) + "</dt><dd>" + esc(fmt(k, r[k])) + "</dd>";
      }).join("") + "</dl></div>";
  document.getElementById("dclose").onclick = function(){ document.getElementById("detail").innerHTML = ""; };
  M.scrollTop = 0;
}

function pct(a, b){ return b ? Math.round((a / b) * 100) : 0; }
function mmss(ms){
  var s = Math.round((ms || 0) / 1000);
  return s >= 60 ? Math.floor(s / 60) + "분 " + (s % 60) + "초" : s + "초";
}
function rank(rows, key, val, text){
  if (!rows.length) return '<p class="note">아직 기록이 없습니다.</p>';
  var top = Math.max.apply(null, rows.map(function(r){ return Number(r[val]) || 0; })) || 1;
  return '<table class="rank">' + rows.map(function(r){
    var n = Number(r[val]) || 0;
    return '<tr><td class="k">' + esc(r[key])
      + '<div class="meter" style="width:' + Math.max(2, pct(n, top)) + '%"></div></td>'
      + '<td class="v">' + esc(text ? text(r) : n) + "</td></tr>";
  }).join("") + "</table>";
}
function panel(title, note, inner){
  return '<div class="panel"><h3>' + esc(title) + "</h3>"
    + (note ? '<p class="note">' + esc(note) + "</p>" : '<div style="height:12px"></div>') + inner + "</div>";
}

var DAYS = 7;
function site(){
  var t = TITLE.site;
  var head = "<h2>" + t[0] + '</h2><p class="sub">' + t[1] + "</p>"
    + '<div class="range">' + [[1,"오늘"],[7,"7일"],[30,"30일"],[365,"전체"]].map(function(o){
        return '<button data-d="' + o[0] + '"' + (DAYS === o[0] ? ' class="on"' : "") + ">" + o[1] + "</button>";
      }).join("") + "</div>";
  M.innerHTML = head + "<p>불러오는 중…</p>";
  function wire(){
    M.querySelectorAll(".range button").forEach(function(b){
      b.onclick = function(){ DAYS = +b.dataset.d; site(); };
    });
  }
  wire();
  api("site?days=" + DAYS).then(function(s){
    var sum = s.sum || {}, stay = s.stay || {};
    var sessions = sum.sessions || 0;
    var cards = [
      ["접속 (세션)", sessions],
      ["순방문자", sum.visitors || 0],
      ["페이지뷰", sum.pageviews || 0],
      ["클릭", sum.clicks || 0],
      ["이탈률", pct(s.bounces, sessions) + "%"],
      ["평균 체류", mmss(stay.avgDwell)],
      ["평균 스크롤", Math.round(stay.avgDepth || 0) + "%"]
    ];
    M.innerHTML = head + '<div class="cards">'
      + cards.map(function(c){ return '<div class="card"><b>' + esc(c[1]) + "</b><span>" + c[0] + "</span></div>"; }).join("")
      + "</div>"
      + panel("무엇을 눌렀나", "버튼·링크별 클릭 수 (괄호는 누른 사람 수)", rank(s.clicks, "label", "n", function(r){ return r.n + " (" + r.sessions + "명)"; }))
      + '<div class="grid2">'
      + panel("어디를 오래 봤나", "구역이 화면에 머문 시간의 합계", rank(s.sections, "label", "total", function(r){ return mmss(r.total) + " · " + r.views + "회"; }))
      + panel("어디서 떠났나", "마지막으로 보고 있던 구역", rank(s.exits, "spot", "n", function(r){ return r.n + "회 · " + mmss(r.avg); }))
      + panel("어디서 왔나", "유입 출처 (호스트만 기록)", rank(s.refs, "src", "n"))
      + panel("기기", "세션 수", rank(s.devices, "device", "n"))
      + panel("주소별 접속", "", rank(s.paths, "path", "n"))
      + panel("날짜별", "접속 / 클릭", rank(s.daily, "d", "sessions", function(r){ return r.sessions + "접속 · " + r.clicks + "클릭"; }))
      + "</div>";
    wire();
  }).catch(function(){});
}

function one(d){ return '<p class="note">' + esc(d) + "</p>"; }

/* 결과 분석 — 사이트 통계와 같은 카드 + 패널 짜임새를 쓴다 */
function results(){
  var t = TITLE.results;
  var head = "<h2>" + t[0] + '</h2><p class="sub">' + t[1] + "</p>";
  M.innerHTML = head + "<p>불러오는 중…</p>";
  api("results").then(function(s){
    var f3 = (s.dists.filter(function(d){ return d.id === "F3"; })[0] || { rows:[] }).rows;
    var yes = (f3.filter(function(r){ return r.k === "예"; })[0] || {}).n || 0;
    var top = s.types[0] || {};
    var cards = [
      ["완료 응답", s.n + "건"],
      ["평균 궁합", s.avgFit === null ? "-" : Math.round(s.avgFit) + "%"],
      ["평균 만족도", s.avgSat === null ? "-" : s.avgSat + " / 7"],
      ["최다 유형", (top.k || "-") + (top.n ? " · " + top.n + "명" : "")],
      ["평균 소요", Math.floor(s.avgDur / 60) + "분 " + (s.avgDur % 60) + "초"],
      ["인터뷰 희망", yes + "명"]
    ];
    var poles = [];
    s.axes.forEach(function(a){
      poles.push({ k:a.frontName, n:a.front }, { k:a.backName, n:a.back });
    });
    var comments = s.comments.length
      ? '<table class="rank">' + s.comments.map(function(c){
          return '<tr><td class="k">' + esc(c.text) + '</td><td class="v">'
            + esc(c.type) + (c.fit === "" || c.fit === null ? "" : " · 궁합 " + c.fit + "%") + "</td></tr>";
        }).join("") + "</table>"
      : one("아직 적힌 코멘트가 없습니다.");

    M.innerHTML = head + '<div class="cards">'
      + cards.map(function(c){ return '<div class="card"><b>' + esc(c[1]) + "</b><span>" + c[0] + "</span></div>"; }).join("")
      + "</div>"
      + panel("16유형 분포", "응답자가 어떤 공간 유형으로 나왔나",
          rank(s.types.map(function(r){ return { k: r.k + (r.name ? " " + r.name : ""), n: r.n }; }), "k", "n",
               function(r){ return r.n + "명 · " + pct(r.n, s.n) + "%"; }))
      + '<div class="grid2">'
      + panel("어느 축이 지금 집과 안 맞나", "성향(P)과 지금 집(S)의 평균 차이 — 클수록 안 맞는다",
          rank(s.axes, "name", "gap", function(r){
            return (r.gap === null ? "-" : r.gap) + " (성향 " + r.P + " / 집 " + r.S + ")"; }))
      + panel("성향 쏠림", "축마다 어느 쪽으로 기울었나 (명)", rank(poles, "k", "n"))
      + panel("결과 코멘트", "F2 · 공감되거나 안 맞았던 부분", comments)
      + s.dists.map(function(d){
          return panel(d.id + ". " + d.text, "", d.rows.length ? rank(d.rows, "k", "n", function(r){
            return r.n + "명 · " + pct(r.n, s.n) + "%"; }) : one("응답 없음"));
        }).join("")
      + panel("날짜별 응답", "", rank(s.daily, "k", "n", function(r){ return r.n + "건"; }))
      + panel("유입", "utm_source", rank(s.utm, "k", "n"))
      + panel("기기", "user_agent 기준", rank(s.device, "k", "n"))
      + "</div>";
  }).catch(function(){});
}

function view(v){
  document.querySelectorAll("nav a[data-v]").forEach(function(a){ a.className = a.dataset.v === v ? "on" : ""; });
  var t = TITLE[v];
  M.innerHTML = "<h2>" + t[0] + '</h2><p class="sub">' + t[1] + "</p><p>불러오는 중…</p>";
  if (v === "site") { site(); return; }
  if (v === "results") { results(); return; }
  if (v === "stats") {
    api("stats").then(function(s){
      M.innerHTML = "<h2>" + t[0] + '</h2><p class="sub">' + t[1] + '</p><div class="cards">'
        + [["완료 응답", s.responses], ["연락처", s.contacts], ["중간 이탈", s.dropoff],
           ["평균 소요", Math.floor(s.avgDurationSec / 60) + "분 " + (s.avgDurationSec % 60) + "초"]]
          .map(function(c){ return '<div class="card"><b>' + esc(c[1]) + "</b><span>" + c[0] + "</span></div>"; }).join("")
        + "</div>";
    }).catch(function(){});
    return;
  }
  api(v).then(function(rows){
    M.innerHTML = "<h2>" + t[0] + '</h2><p class="sub">' + t[1] + " · " + rows.length + '건</p>'
      + '<div class="bar"><button class="ghost" id="csv">CSV 내려받기</button></div>' + table(rows);
    document.getElementById("csv").onclick = function(){ location.href = "/api/admin/" + v + "?format=csv"; };
    M.querySelectorAll("tr.pick").forEach(function(tr){ tr.onclick = function(){ detail(+tr.dataset.i); }; });
  }).catch(function(){});
}

function show(ok){
  document.getElementById("login").style.display = ok ? "none" : "block";
  document.getElementById("shell").style.display = ok ? "grid" : "none";
  if (!ok) return;
  api("labels").then(function(m){ LBL = m || {}; }).catch(function(){});
  view("stats");
}
document.getElementById("go").onclick = function(){
  fetch("/api/login", { method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ pw: document.getElementById("pw").value }) })
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j.ok) show(true); else document.getElementById("err").style.display = "block"; });
};
document.getElementById("pw").onkeydown = function(e){ if (e.key === "Enter") document.getElementById("go").click(); };
document.getElementById("pweye").onclick = function(){
  var pw = document.getElementById("pw"), show = pw.type === "password";
  pw.type = show ? "text" : "password";
  this.setAttribute("aria-pressed", show ? "true" : "false");
  this.setAttribute("aria-label", show ? "비밀번호 숨기기" : "비밀번호 보기");
  pw.focus();
};
document.getElementById("out").onclick = function(){ fetch("/api/logout").then(function(){ location.reload(); }); };
document.querySelectorAll("nav a[data-v]").forEach(function(a){ a.onclick = function(){ view(a.dataset.v); }; });

/* 쿠키가 살아 있으면 로그인 화면을 건너뛴다 */
fetch("/api/admin/stats", { credentials:"same-origin" }).then(function(r){ show(r.ok); });
</script></body></html>`;
