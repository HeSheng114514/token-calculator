/* 截图：用于人工检查界面视觉效果 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const PROFILE = path.join(process.env.TEMP, 'edge-shot-token');
const URL = process.argv[2] || 'http://127.0.0.1:8791/index.html';
const OUT = process.argv[3] || path.join(__dirname, 'shot.png');
const WIDTH = Number(process.argv[4] || 1500);
const HEIGHT = Number(process.argv[5] || 1200);

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
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    `--window-size=${WIDTH},${HEIGHT}`, URL], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await getWs());
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const send = client(ws);
    await send('Runtime.enable');
    await send('Page.enable');
    const ev = e => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });

    for (let i = 0; i < 200; i++) {
      const ok = await ev("!!document.querySelector('#stats .stat.hero .v') && (document.querySelector('#engineInfo').textContent||'').indexOf('已加载')>=0");
      if (ok.result.value) break;
      await sleep(250);
    }
    // 换成更能体现高亮的示例文本
    await ev(`(async()=>{
      document.querySelector('#editor').value = '你好，世界！Token 计算器 hello world\\n\\n人工智能 AI 正在改变我们的工作方式。\\n\\ndef greet(name):\\n    return f"Hi, {name}!"';
      document.querySelector('#editor').dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,600));
      return 1;
    })()`);
    await sleep(900);

    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(OUT, Buffer.from(r.data, 'base64'));
    console.log('[ok] ' + OUT + '  ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
    ws.close();
  } finally {
    child.kill();
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
})().catch(e => { console.error('截图失败:', e.message); process.exit(1); });
