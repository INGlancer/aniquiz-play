// ── 애니퀴즈 접속 문 (Render 무료 플랜용) ──
// 하는 일은 하나뿐입니다: "지금 서버가 켜져 있는지, 켜져 있다면 주소가 무엇인지".
//
//   POST /update   런처가 현재 상태를 알려줍니다 (헤더 x-door-key 로 인증)
//   GET  /status   페이지가 상태를 물어봅니다 (CORS 허용, 캐시 없음)
//   GET  /go       현재 터널 주소로 바로 이동 (친구에게 이 주소만 줘도 됩니다)
//   GET  /         간단한 안내 페이지
//
// 무료 플랜은 15분간 아무도 안 오면 잠들고, 깨어날 때 메모리가 비워집니다.
// 그래서 상태가 비어 있으면 GitHub 의 status.json 을 한 번 읽어 씨앗으로 씁니다.
// (그 값은 최대 5분 묵은 값일 수 있지만, 비어 있는 것보다는 낫습니다)

const http = require('http');

const PORT = process.env.PORT || 10000;
const DOOR_KEY = process.env.DOOR_KEY || '';          // 런처와 나눠 갖는 비밀값
const SEED_URL = process.env.SEED_URL ||              // 깨어났을 때 참고할 백업 위치
  'https://raw.githubusercontent.com/INGlancer/aniquiz-play/main/status.json';

let state = null;          // { online, url, at }
let seedTried = false;

function nowIso() {
  return new Date().toISOString();
}

// 켜짐 상태가 너무 오래 갱신되지 않았다면 런처가 죽은 것으로 보고 꺼짐 취급합니다.
const STALE_MS = 45 * 60 * 1000;

function currentState() {
  if (!state) return { online: false, url: '', at: null, source: 'empty' };
  const age = Date.now() - Date.parse(state.at || 0);
  if (state.online && age > STALE_MS) {
    return { online: false, url: '', at: state.at, source: state.source || 'launcher', stale: true };
  }
  return state;
}

async function seedFromBackup() {
  if (seedTried || state) return;
  seedTried = true;
  try {
    const res = await fetch(SEED_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const d = await res.json();
    if (d && typeof d === 'object') {
      state = { online: !!d.online, url: d.url || '', at: d.at || nowIso(), source: 'backup' };
      console.log('[door] 백업에서 상태를 읽어왔습니다:', state.online ? '켜짐' : '꺼짐');
    }
  } catch (e) {
    console.warn('[door] 백업 읽기 실패:', e.message);
  }
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, x-door-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (c) => {
      data += c;
      if (data.length > 10000) { tooBig = true; req.destroy(); }   // 쓰레기 요청 방어
    });
    req.on('end', () => (tooBig ? reject(new Error('too large')) : resolve(data)));
    req.on('error', reject);
  });
}

// 문에서 직접 보여주는 페이지.
// GitHub Pages 쪽 페이지와 안내 문구·디자인을 똑같이 맞춰 둡니다.
// (이 주소도 고정이라 북마크 대상이고, 들어온 사람이 보는 내용이 달라야 할 이유가 없습니다)
const PAGE = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>애니 퀴즈 접속</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎵</text></svg>">
<style>
 :root{--bg:#0f1424;--card:#16213e;--line:#2d2d44;--ink:#eef1f8;--dim:#8b93a7;
       --on:#4ecca3;--off:#e94560;--warn:#ffb020;}
 *{box-sizing:border-box;}
 body{margin:0;min-height:100dvh;background:var(--bg);color:var(--ink);
   font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic','맑은 고딕',sans-serif;
   display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;gap:18px;}
 .card{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);
   border-radius:18px;padding:28px 24px;box-shadow:0 18px 50px rgba(0,0,0,.45);
   display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center;}
 h1{margin:0;font-size:19px;letter-spacing:-.3px;} h1 span{color:var(--on);}
 .status{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:700;}
 .dot{width:13px;height:13px;border-radius:50%;background:var(--dim);flex:0 0 auto;}
 .dot.on{background:var(--on);box-shadow:0 0 0 0 rgba(78,204,163,.55);animation:pulse 2s infinite;}
 .dot.off{background:var(--off);} .dot.warn{background:var(--warn);}
 @keyframes pulse{70%{box-shadow:0 0 0 12px rgba(78,204,163,0);}100%{box-shadow:0 0 0 0 rgba(78,204,163,0);}}
 @media (prefers-reduced-motion:reduce){.dot.on{animation:none;}}
 .btn{width:100%;padding:15px 20px;border-radius:11px;border:none;cursor:pointer;
   font-size:16px;font-weight:800;font-family:inherit;text-decoration:none;
   display:flex;align-items:center;justify-content:center;gap:8px;
   background:var(--on);color:#10251d;transition:transform .08s ease,filter .15s ease;}
 .btn:hover{filter:brightness(1.07);} .btn:active{transform:translateY(1px);}
 .btn[aria-disabled="true"]{background:#232a3f;color:#5c6479;cursor:not-allowed;filter:none;transform:none;}
 .meta{font-size:11.5px;color:var(--dim);display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;}
 .refresh{background:none;border:1px solid var(--line);color:var(--dim);font-family:inherit;
   font-size:11.5px;padding:4px 10px;border-radius:999px;cursor:pointer;}
 .refresh:hover{color:var(--ink);border-color:#3d4260;}
 .tips{width:100%;border-top:1px solid var(--line);padding-top:16px;
   font-size:12px;color:var(--dim);line-height:1.75;text-align:left;}
 .tips b{color:#b9c2d6;font-weight:700;}
 .foot{font-size:11px;color:#5c6479;}
</style></head><body>
 <main class="card">
   <h1>🎵 애니 &amp; 노래 <span>맞추기 퀴즈</span></h1>
   <div class="status"><span class="dot" id="dot"></span><span id="statusText">상태 확인 중…</span></div>
   <a class="btn" id="joinBtn" aria-disabled="true" href="#">접속 주소를 불러오는 중…</a>
   <div class="meta"><span id="updated">—</span>
     <button class="refresh" id="refreshBtn" type="button">새로고침</button></div>
   <div class="tips">
     <b>이 페이지를 북마크해 두세요.</b><br>
     게임 서버 주소는 켤 때마다 바뀌지만, 이 주소는 그대로입니다.
     서버가 켜져 있으면 위 버튼이 현재 주소로 연결해 줍니다.<br>
     방금 켜졌는데 꺼짐으로 보이면 <b>새로고침</b>을 눌러 주세요.
   </div>
 </main>
 <div class="foot">상태는 바로 반영됩니다 · 바로 보려면 <b>새로고침</b></div>
<script>
(function(){
 var dot=document.getElementById('dot'), st=document.getElementById('statusText'),
     btn=document.getElementById('joinBtn'), up=document.getElementById('updated'),
     rf=document.getElementById('refreshBtn');
 function ago(iso){var t=Date.parse(iso||'');if(isNaN(t))return null;
   var s=Math.max(0,Math.round((Date.now()-t)/1000));
   if(s<60)return '방금 전';var m=Math.round(s/60);if(m<60)return m+'분 전';
   var h=Math.round(m/60);if(h<24)return h+'시간 전';return Math.round(h/24)+'일 전';}
 btn.addEventListener('click',function(e){if(btn.getAttribute('aria-disabled')==='true')e.preventDefault();});
 var busy=false;
 function tick(){
   if(busy)return; busy=true; rf.disabled=true;
   fetch('/status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
     d=d||{};
     if(d.online&&d.url){
       dot.className='dot on'; st.textContent='서버 켜짐';
       btn.textContent='🚀 게임 접속하기'; btn.href=d.url;
       btn.setAttribute('aria-disabled','false'); btn.removeAttribute('tabindex');
     }else{
       dot.className='dot off'; st.textContent='서버 꺼짐';
       btn.textContent='지금은 접속할 수 없습니다'; btn.href='#';
       btn.setAttribute('aria-disabled','true'); btn.setAttribute('tabindex','-1');
     }
     up.textContent=d.at?('마지막 갱신 '+(ago(d.at)||'-')):'';
   }).catch(function(){
     dot.className='dot warn'; st.textContent='상태를 불러오지 못했습니다';
     btn.textContent='상태를 확인할 수 없습니다'; btn.setAttribute('aria-disabled','true');
   }).then(function(){busy=false;rf.disabled=false;});
 }
 rf.addEventListener('click',tick);
 document.addEventListener('visibilitychange',function(){if(!document.hidden)tick();});
 tick(); setInterval(function(){if(!document.hidden)tick();},10000);
})();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  // 런처가 상태를 올리는 곳
  if (path === '/update' && req.method === 'POST') {
    if (!DOOR_KEY || req.headers['x-door-key'] !== DOOR_KEY) {
      return sendJson(res, 403, { ok: false, reason: 'bad key' });
    }
    let body;
    try { body = JSON.parse(await readBody(req) || '{}'); }
    catch (e) { return sendJson(res, 400, { ok: false, reason: 'bad body' }); }
    state = {
      online: !!body.online,
      url: typeof body.url === 'string' ? body.url.slice(0, 300) : '',
      at: nowIso(),
      source: 'launcher',
    };
    seedTried = true;   // 런처가 직접 알려줬으니 백업은 더 볼 필요 없음
    console.log('[door] 상태 갱신:', state.online ? '켜짐 ' + state.url : '꺼짐');
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/status') {
    await seedFromBackup();
    return sendJson(res, 200, currentState());
  }

  // 바로 게임으로 보내는 문
  if (path === '/go') {
    await seedFromBackup();
    const s = currentState();
    if (s.online && s.url) {
      res.writeHead(302, { Location: s.url, 'Cache-Control': 'no-store' });
      return res.end();
    }
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('<meta charset="utf-8"><body style="background:#0f1424;color:#eee;font-family:sans-serif;text-align:center;padding:60px">🔴 지금은 서버가 꺼져 있습니다.</body>');
  }

  if (path === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(PAGE);
  }

  sendJson(res, 404, { ok: false });
});

server.listen(PORT, () => console.log('[door] 대기 중 — 포트 ' + PORT));
