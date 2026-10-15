/* 在真实页面里执行任意 JS 表达式并打印结果（用于精确核对 DOM 内容） */
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const PROFILE = path.join(process.env.TEMP, 'edge-eval-token');
const URL = process.argv[2] || 'http://127.0.0.1:8791/index.html';
const EXPR = process.argv[3] || '1';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('no ws');
}

let id = 0;
function client(ws) {
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  });
  return (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
}

(async () => {
  const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1500,1000', URL], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await getWs());
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const send = client(ws);
    await send('Runtime.enable');
    const ev = e => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });

    for (let i = 0; i < 200; i++) {
      const ok = await ev("(document.querySelector('#engineInfo').textContent||'').indexOf('已加载')>=0");
      if (ok.result.value) break;
      await sleep(250);
    }
    const r = await ev(EXPR);
    if (r.exceptionDetails) { console.error('异常:', r.exceptionDetails.text, JSON.stringify(r.exceptionDetails.exception)); process.exit(2); }
    console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 2));
    ws.close();
  } finally {
    child.kill();
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
