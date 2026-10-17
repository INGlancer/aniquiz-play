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

const PAGE = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>애니 퀴즈 접속</title>
<style>
 body{margin:0;min-height:100dvh;background:#0f1424;color:#eef1f8;display:flex;
      align-items:center;justify-content:center;padding:24px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;}
 .c{background:#16213e;border:1px solid #2d2d44;border-radius:18px;padding:28px 24px;
    width:100%;max-width:420px;text-align:center;display:flex;flex-direction:column;gap:16px;}
 h1{margin:0;font-size:18px;} .s{font-size:16px;font-weight:700;}
 a.b{display:block;padding:14px;border-radius:11px;background:#4ecca3;color:#10251d;
     text-decoration:none;font-weight:800;}
 a.b[aria-disabled=true]{background:#232a3f;color:#5c6479;pointer-events:none;}
 .m{font-size:11.5px;color:#8b93a7;}
</style></head><body>
<div class="c">
  <h1>🎵 애니 &amp; 노래 맞추기 퀴즈</h1>
  <div class="s" id="s">확인 중…</div>
  <a class="b" id="b" aria-disabled="true" href="#">잠시만요…</a>
  <div class="m" id="m"></div>
</div>
<script>
async function tick(){
  try{
    const d = await (await fetch('/status',{cache:'no-store'})).json();
    const s=document.getElementById('s'), b=document.getElementById('b'), m=document.getElementById('m');
    if(d.online && d.url){ s.textContent='🟢 서버 켜짐'; b.textContent='🚀 게임 접속하기';
      b.href=d.url; b.setAttribute('aria-disabled','false'); }
    else { s.textContent='🔴 서버 꺼짐'; b.textContent='지금은 접속할 수 없습니다';
      b.href='#'; b.setAttribute('aria-disabled','true'); }
    m.textContent = d.at ? ('마지막 갱신 ' + new Date(d.at).toLocaleString('ko-KR')) : '';
  }catch(e){}
}
tick(); setInterval(()=>{ if(!document.hidden) tick(); }, 10000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) tick(); });
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
