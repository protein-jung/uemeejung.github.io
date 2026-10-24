/* admin.uemeejung.com — 테스트 응답 수집 + 열람
   수집은 공개(테스트 페이지가 CORS 로 POST), 열람은 ADMIN_PW 로 잠근다. */

const SITE = "https://uemeejung.com";
const KINDS = { responses: "responses", contacts: "contacts", dropoff: "dropoff" };
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
 button{padding:10px 14px;border:0;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer}
 #shell{display:none;grid-template-columns:200px 1fr;min-height:100vh}
 nav{background:#fff;border-right:1px solid var(--line);padding:20px 0}
 nav h1{font-size:14px;margin:0 20px 16px;letter-spacing:-.02em}
 nav a{display:block;padding:9px 20px;color:var(--ink);text-decoration:none;cursor:pointer}
 nav a.on{background:var(--bg);font-weight:600;box-shadow:inset 3px 0 var(--accent)}
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
</style></head><body>
<div id="login">
  <div style="font-weight:700">uemeejung 관리자</div>
  <input id="pw" type="password" placeholder="비밀번호" autocomplete="current-password">
  <button style="width:100%;margin-top:10px" id="go">들어가기</button>
  <p id="err" style="color:#b02a2a;font-size:12px;display:none">비밀번호가 맞지 않습니다</p>
</div>
<div id="shell">
  <nav>
    <h1>uemeejung</h1>
    <a data-v="stats">개요</a>
    <a data-v="responses">공간 궁합 테스트</a>
    <a data-v="contacts">인터뷰 연락처</a>
    <a data-v="dropoff">중간 이탈</a>
    <a id="out" style="color:#777;margin-top:20px">로그아웃</a>
  </nav>
  <main id="main"></main>
</div>
<script>
var M = document.getElementById("main");
var TITLE = { stats:["개요","수집 현황"], responses:["공간 궁합 테스트","/neuroroomie/1/ 완료 응답"], contacts:["인터뷰 연락처","심층 인터뷰에 동의한 분"], dropoff:["중간 이탈","끝까지 가지 않은 기록"] };

function api(path){ return fetch("/api/admin/" + path, { credentials:"same-origin" }).then(function(r){
  if (r.status === 401) { show(false); throw new Error("auth"); }
  return r.json();
}); }

function esc(s){ return String(s === undefined || s === null ? "" : s).replace(/[&<>"]/g, function(c){ return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]; }); }

function table(rows){
  if (!rows.length) return '<p class="sub">아직 수집된 데이터가 없습니다.</p>';
  var cols = [];
  rows.forEach(function(r){ Object.keys(r).forEach(function(k){ if (cols.indexOf(k) < 0) cols.push(k); }); });
  return '<div class="wrap"><table><thead><tr>' + cols.map(function(c){ return "<th>" + esc(c) + "</th>"; }).join("")
    + "</tr></thead><tbody>" + rows.map(function(r){
        return "<tr>" + cols.map(function(c){ return "<td>" + esc(r[c]) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
}

function view(v){
  document.querySelectorAll("nav a[data-v]").forEach(function(a){ a.className = a.dataset.v === v ? "on" : ""; });
  var t = TITLE[v];
  M.innerHTML = "<h2>" + t[0] + '</h2><p class="sub">' + t[1] + "</p><p>불러오는 중…</p>";
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
  }).catch(function(){});
}

function show(ok){
  document.getElementById("login").style.display = ok ? "none" : "block";
  document.getElementById("shell").style.display = ok ? "grid" : "none";
  if (ok) view("stats");
}
document.getElementById("go").onclick = function(){
  fetch("/api/login", { method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ pw: document.getElementById("pw").value }) })
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j.ok) show(true); else document.getElementById("err").style.display = "block"; });
};
document.getElementById("pw").onkeydown = function(e){ if (e.key === "Enter") document.getElementById("go").click(); };
document.getElementById("out").onclick = function(){ fetch("/api/logout").then(function(){ location.reload(); }); };
document.querySelectorAll("nav a[data-v]").forEach(function(a){ a.onclick = function(){ view(a.dataset.v); }; });

/* 쿠키가 살아 있으면 로그인 화면을 건너뛴다 */
fetch("/api/admin/stats", { credentials:"same-origin" }).then(function(r){ show(r.ok); });
</script></body></html>`;
