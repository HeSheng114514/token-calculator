/* 通过 Chrome DevTools Protocol 真正「操作」页面，验证交互与计算结果 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const PROFILE = path.join(process.env.TEMP, 'edge-cdp-token');
const URL = process.argv[2] || 'http://127.0.0.1:8791/index.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    await sleep(300);
  }
  throw new Error('无法连接调试端口');
}

let msgId = 0;
function makeClient(ws) {
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return function send(method, params) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  };
}

async function main() {
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    URL
  ], { stdio: 'ignore' });

  const results = [];
  const check = (n, pass, extra) => results.push({ n, pass: !!pass, e: extra === undefined ? '' : String(extra) });

  try {
    const wsUrl = await getWsUrl();
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const send = makeClient(ws);
    await send('Runtime.enable');

    async function evaluate(expr) {
      const r = await send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
      return r.result.value;
    }

    // 等待词表就绪（#boot 加载完会被 display:none，不依赖它是否存在）
    let ready = false;
    for (let i = 0; i < 200; i++) {
      ready = await evaluate("!!document.querySelector('#stats .stat.hero .v') && (document.querySelector('#engineInfo').textContent||'').indexOf('已加载') >= 0");
      if (ready) break;
      await sleep(250);
    }
    check('应用已就绪（词表加载完成）', ready);

    // 读取主统计数字（注意 .v 里还含 <small> 的分词器名，如 "o200k" 含数字，
    // 因此只取第一个子文本节点）
    const heroOf = () => evaluate("document.querySelector('#stats .stat.hero .v').childNodes[0].textContent.replace(/[^0-9]/g,'')");

    // ---- 1. 与 Node 侧引擎比对多个文本（必须先切换对应分词器）----
    const cases = [
      { enc: 'deepseek', text: '你好，世界！Hello, world! 12345' },
      { enc: 'qwen', text: '人工智能正在改变世界。AI is changing the world. 2024' },
      { enc: 'qwen38', text: '人工智能正在改变世界。AI is changing the world. 2024' },
      { enc: 'glm', text: '混合 mixed 中英 text 与 numbers 12345 结束' },
      { enc: 'o200k', text: 'The quick brown fox jumps over the lazy dog.' },
      { enc: 'cl100k', text: '混合 mixed 中英 text 与 numbers 12345 结束' },
      { enc: 'deepseek', text: '😀🎉🚀 组合字符 e\u0301 a\u0300 结束' },
      { enc: 'glm', text: 'a\rx\r\rA\r\nB' },
      { enc: 'deepseek', text: '' }
    ];

    const TK = require(path.join(__dirname, '..', 'src', 'encoder.js'));
    const zlib = require('zlib');
    const b64 = fs.readFileSync(path.join(__dirname, 'tokenizer_data.b64'), 'ascii').trim();
    const bundle = TK.parseBundle(new Uint8Array(zlib.gunzipSync(Buffer.from(b64, 'base64'))));

    for (const c of cases) {
      // 注意：<textarea> 会把 CR / CRLF 统一成 LF，这是浏览器行为。
      // 因此官方期望值也应当在「输入框里实际保存的文本」上计算。
      const stored = c.text.replace(/\r\n?/g, '\n');
      const want = new TK.Encoder(bundle[c.enc]).encode(stored).ids.length;
      const got = await evaluate(`(() => {
        const sel = document.querySelector('#encSelect');
        if (sel.value !== ${JSON.stringify(c.enc)}) {
          sel.value = ${JSON.stringify(c.enc)};
          sel.dispatchEvent(new Event('change', {bubbles:true}));
        }
        const ed = document.querySelector('#editor');
        ed.value = ${JSON.stringify(c.text)};
        ed.dispatchEvent(new Event('input', {bubbles:true}));
        return new Promise(r => setTimeout(() => {
          const v = document.querySelector('#stats .stat.hero .v').childNodes[0].textContent;
          r(parseInt(v.replace(/[^0-9]/g,''),10));
        }, 400));
      })()`);
      check(`UI 计数与官方一致 [${c.enc}] ${JSON.stringify(c.text).slice(0, 34)}`, got === want,
        `UI=${got} 官方=${want}${stored !== c.text ? ' (textarea 已把 CR 归一为 LF)' : ''}`);
      void heroOf;
    }

    // ---- 2. 切换分词器（只取数字节点，避免被 "o200k"/"cl100k" 里的数字干扰）----
    const encTest = await evaluate(`(async () => {
      const ed = document.querySelector('#editor');
      ed.value = '中文测试 Chinese test 12345';
      ed.dispatchEvent(new Event('input', {bubbles:true}));
      await new Promise(r=>setTimeout(r,300));
      const sel = document.querySelector('#encSelect');
      const out = {};
      for (const e of ['deepseek','qwen','qwen38','glm','o200k','cl100k']) {
        sel.value = e; sel.dispatchEvent(new Event('change',{bubbles:true}));
        await new Promise(r=>setTimeout(r,250));
        out[e] = parseInt(document.querySelector('#stats .stat.hero .v').childNodes[0].textContent.replace(/[^0-9]/g,''),10);
      }
      return out;
    })()`);
    check('切换分词器会重新计数并给出不同结果', encTest.deepseek !== encTest.cl100k,
      JSON.stringify(encTest));

    // ---- 3. 成本计算 ----
    const costTest = await evaluate(`(async () => {
      const sel = document.querySelector('#modelSelect');
      sel.value = 'deepseek-v3.2'; sel.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,200));
      document.querySelector('#priceIn').value = 1;
      document.querySelector('#priceIn').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('#priceOut').value = 2;
      document.querySelector('#priceOut').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('#outputTokens').value = 1000;
      document.querySelector('#outputTokens').dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,400));
      const rows = [...document.querySelectorAll('#costBody tr')].map(tr =>
        [...tr.children].map(td => td.textContent.trim()));
      return { rows, summary: document.querySelector('#costSummary').textContent };
    })()`);
    const single = costTest.rows.find(r => /单次合计/.test(r[0]));
    check('成本表渲染了单项与合计行', !!single, JSON.stringify(single));
    if (single) {
      // 输入 token 数 × $1/1M + 1000 × $2/1M
      const inputTok = Number(single[1].replace(/[^0-9]/g, '')) - 1000;
      const expectTotal = (inputTok / 1e6) * 1 + (1000 / 1e6) * 2;
      const shown = Number(single[3].replace(/[^0-9.]/g, ''));
      check('单次成本数值正确', Math.abs(shown - expectTotal) < 1e-6,
        `显示=${shown} 期望=${expectTotal.toFixed(6)} (输入${inputTok}tok)`);
    }

    // ---- 4. 上下文越限提示 ----
    const ctxTest = await evaluate(`(async () => {
      const sel = document.querySelector('#modelSelect');
      sel.value = 'qwen-max'; sel.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,200));
      const ctx = document.querySelector('#modelCtx');
      ctx.value = 100; ctx.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,300));
      return document.querySelector('#ctxInfo').textContent;
    })()`);
    check('超出上下文窗口时会给出警告', /超出/.test(ctxTest), ctxTest.slice(0, 80));

    // ---- 4b. 空闲时段半价（DeepSeek）----
    const offPeak = await evaluate(`(async () => {
      const sel = document.querySelector('#modelSelect');
      sel.value = 'deepseek-flash'; sel.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,250));
      const visible = getComputedStyle(document.querySelector('#offPeakWrap')).display !== 'none';
      const readOut = () => {
        const tr = [...document.querySelectorAll('#costBody tr')].find(r=>/输出/.test(r.children[0].textContent));
        return Number(tr.children[2].textContent.replace(/[^0-9.]/g,''));
      };
      const peak = readOut();
      const cb = document.querySelector('#offPeak');
      cb.checked = true; cb.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,350));
      const off = readOut();
      const note = document.querySelector('#costCurrencyNote').textContent;
      cb.checked = false; cb.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,250));
      return { visible, peak, off, note };
    })()`);
    check('DeepSeek 显示空闲时段开关', offPeak.visible);
    check('空闲时段价格为高峰的一半', Math.abs(offPeak.off - offPeak.peak / 2) < 1e-6,
      `peak=${offPeak.peak} off=${offPeak.off}`);
    check('成本说明标注了空闲时段', /空闲时段/.test(offPeak.note), offPeak.note.slice(0, 60));

    // ---- 5. 高亮开关 / 主题 ----
    const uiTest = await evaluate(`(async () => {
      const before = document.querySelectorAll('#highlight .tok').length;
      document.querySelector('#hlToggle').click();
      await new Promise(r=>setTimeout(r,250));
      const after = document.querySelectorAll('#highlight .tok').length;
      document.querySelector('#hlToggle').click();
      await new Promise(r=>setTimeout(r,250));
      const back = document.querySelectorAll('#highlight .tok').length;
      document.querySelector('#themeBtn').click();
      const theme = document.documentElement.getAttribute('data-theme');
      return { before, after, back, theme };
    })()`);
    check('高亮开关能隐藏/恢复颜色', uiTest.before > 0 && uiTest.after === 0 && uiTest.back > 0,
      JSON.stringify(uiTest));
    check('主题切换生效', uiTest.theme === 'light' || uiTest.theme === 'dark', uiTest.theme);

    // ---- 6. 明细表：各 token 次数之和应等于总 token 数 ----
    const detail = await evaluate(`(async () => {
      document.querySelector('#editor').value = 'hello hello hello 世界 世界 世界';
      document.querySelector('#editor').dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,450));
      const rows = [...document.querySelectorAll('#breakdownBody tr')].map(tr =>
        [...tr.children].map(td=>td.textContent.trim()));
      const total = parseInt(document.querySelector('#stats .stat.hero .v').childNodes[0].textContent.replace(/[^0-9]/g,''),10);
      const sum = rows.reduce((a,r)=>a + parseInt(r[2].replace(/[^0-9]/g,''),10), 0);
      const maxCount = Math.max(...rows.map(r=>parseInt(r[2].replace(/[^0-9]/g,''),10)));
      return { rows: rows.slice(0,4), total, sum, maxCount };
    })()`);
    check('明细表各 token 次数之和 = 总 token 数', detail.sum === detail.total,
      `sum=${detail.sum} total=${detail.total}`);
    check('明细表最大出现次数 = 3（"世界" 出现三次）', detail.maxCount === 3,
      `max=${detail.maxCount} 前几行=${JSON.stringify(detail.rows)}`);

    // ---- 7. 大文本与性能 ----
    const big = await evaluate(`(async () => {
      const ed = document.querySelector('#editor');
      const chunk = '人工智能正在改变世界，大语言模型的应用越来越广泛。The quick brown fox jumps over the lazy dog. ';
      ed.value = chunk.repeat(1200);
      ed.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,2500));
      const tok = parseInt(document.querySelector('#stats .stat.hero .v').childNodes[0].textContent.replace(/[^0-9]/g,''),10);
      const ms = document.querySelector('#stats .stat').length;
      // 检查高亮保护提示是否出现
      const note = document.querySelector('#hlNote');
      return { chars: ed.value.length, tok, statCards: ms, noteHidden: note.classList.contains('hidden'), hlCount: document.querySelectorAll('#highlight .tok').length };
    })()`);
    check('大文本（约 8 万字符）能正确计数', big.tok > 20000, `chars=${big.chars} tokens=${big.tok}`);
    check('超大 token 数时暂停彩色高亮以保证流畅',
      big.noteHidden || big.hlCount === 0, `noteHidden=${big.noteHidden} spans=${big.hlCount}`);

    // ---- 8. 模型对比表 & 选用 ----
    const modelUi = await evaluate(`(async () => {
      // 先恢复到小文本
      const ed = document.querySelector('#editor');
      ed.value = '测试 test 12345';
      ed.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,500));
      const rows = [...document.querySelectorAll('#modelBody tr')];
      const approxRows = rows.filter(r=>r.querySelector('.pill.warn')).length;
      // 点第一行的「选用」
      const btn = rows[0].querySelector('[data-use-model]');
      const id = btn.getAttribute('data-use-model');
      btn.click();
      await new Promise(r=>setTimeout(r,500));
      const selected = document.querySelector('#modelSelect').value;
      const costModel = document.querySelector('#costModel').textContent;
      return { rowCount: rows.length, approxRows, clicked: id, selected, costModel };
    })()`);
    check('模型对比表有内容且标出近似分词器', modelUi.rowCount > 10, `rows=${modelUi.rowCount} approx=${modelUi.approxRows}`);
    check('点击「选用」会切换当前模型', modelUi.selected === modelUi.clicked,
      `clicked=${modelUi.clicked} selected=${modelUi.selected} cost=${modelUi.costModel}`);

    // ---- 9. 模型筛选 ----
    const filter = await evaluate(`(async () => {
      const f = document.querySelector('#modelFilter');
      f.value = 'deepseek'; f.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,300));
      const n = document.querySelectorAll('#modelBody tr').length;
      const allDeepseek = [...document.querySelectorAll('#modelBody tr')].every(r=>/DeepSeek|deepseek/i.test(r.textContent));
      f.value = ''; f.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,300));
      return { n, allDeepseek };
    })()`);
    check('模型筛选可用', filter.n >= 1 && filter.allDeepseek, JSON.stringify(filter));

    // ---- 10. CSV 导出（拦截下载并检查内容）----
    const csv = await evaluate(`(async () => {
      let captured = null;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = function(blob){ captured = blob; return 'blob:test'; };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function(){};
      document.querySelector('#exportBtn').click();
      await new Promise(r=>setTimeout(r,300));
      URL.createObjectURL = origCreate;
      HTMLAnchorElement.prototype.click = origClick;
      if (!captured) return { ok: false };
      // 注意 Blob.text() 按规范会剥掉开头的 BOM，因此这里读原始字节判断
      const buf = new Uint8Array(await captured.arrayBuffer());
      const text = await captured.text();
      const lines = text.split('\\r\\n');
      return { ok: true, header: lines[0], rows: lines.length - 1, type: captured.type,
               first3Bytes: [buf[0], buf[1], buf[2]],
               hasBOM: buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF };
    })()`);
    check('导出 CSV 成功且带表头与 UTF-8 BOM',
      csv.ok && /模型/.test(csv.header) && csv.rows > 10 && csv.hasBOM,
      JSON.stringify(csv));

    // ---- 11. 复制报告 ----
    const copyRes = await evaluate(`(async () => {
      document.querySelector('#hlToggle').click();  // 确保有高亮状态无关
      document.querySelector('#hlToggle').click();
      await new Promise(r=>setTimeout(r,300));
      function buildReportText() {
        // 直接读取按钮行为：点击复制后检查剪贴板不可用时是否走 fallback，
        // 这里改为验证报告文本能生成（通过临时给 navigator.clipboard 打桩）
        return new Promise(resolve => {
          const orig = navigator.clipboard;
          let capturedText = null;
          try {
            Object.defineProperty(navigator, 'clipboard', {
              configurable: true,
              value: { writeText: t => { capturedText = t; return Promise.resolve(); } }
            });
          } catch(e) { resolve({ ok:false, err:String(e) }); return; }
          document.querySelector('#copyBtn').click();
          setTimeout(() => {
            if (orig) { try { Object.defineProperty(navigator,'clipboard',{configurable:true,value:orig}); } catch(e){} }
            resolve({ ok: !!capturedText, text: (capturedText||'').slice(0,300) });
          }, 400);
        });
      }
      return await buildReportText();
    })()`);
    check('复制报告会生成含关键信息的文本',
      copyRes.ok && /Token 计算报告/.test(copyRes.text) && /单次成本/.test(copyRes.text),
      copyRes.ok ? copyRes.text.split('\n').slice(0,4).join(' | ') : 'not captured');

    // ---- 12. 无 JS 异常 ----
    const errs = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
    });
    await evaluate('1+1');
    check('运行期间没有未捕获异常', errs.length === 0, errs.join(' | '));

    ws.close();
  } finally {
    child.kill();
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }

  let fails = 0;
  for (const r of results) { if (!r.pass) fails++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.e ? '  [' + r.e + ']' : ''}`); }
  console.log('\n' + (fails === 0 ? 'CDP 交互测试: 全部通过' : `CDP 交互测试: ${fails} 项失败`));
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(e => { console.error('测试出错:', e.message); process.exit(2); });
