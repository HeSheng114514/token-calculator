/* 用无头浏览器加载 index.html，验证页面真的能跑起来并给出正确结果 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8791/index.html';
const PROFILE = path.join(process.env.TEMP, 'edge-token-test');

const script = `
(async () => {
  const out = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 等待词表加载完成
  for (let i = 0; i < 120; i++) {
    if (document.querySelector('#boot').classList.contains('hide')) break;
    await sleep(250);
  }
  out.bootHidden = document.querySelector('#boot').classList.contains('hide');
  out.engineInfo = document.querySelector('#engineInfo').textContent;
  out.statsHTML = document.querySelector('#stats').textContent.slice(0, 200);
  out.tokenStat = (document.querySelector('#stats .stat.hero .v') || {}).textContent;
  out.hlSpans = document.querySelectorAll('#highlight .tok').length;
  out.breakdownRows = document.querySelectorAll('#breakdownBody tr').length;
  out.modelRows = document.querySelectorAll('#modelBody tr').length;
  out.costRows = document.querySelectorAll('#costBody tr').length;
  out.ctxInfo = document.querySelector('#ctxInfo').textContent.trim().slice(0, 160);
  out.errors = window.__errs || [];
  return JSON.stringify(out);
})()
`;

const args = [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + PROFILE, '--virtual-time-budget=25000',
  '--dump-dom', URL
];

const r = spawnSync(EDGE, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
const dom = r.stdout || '';
fs.writeFileSync(path.join(__dirname, 'dom_dump.html'), dom);

const checks = [];
function check(name, cond, extra) {
  checks.push({ name, pass: !!cond, extra: extra === undefined ? '' : String(extra) });
}

check('页面返回了 DOM', dom.length > 2000, dom.length + ' bytes');
check('渲染出了统计卡片', /class="stat/.test(dom));
check('渲染出了 token 明细行', /id="breakdownBody"[\s\S]{0,20000}?<tr>/.test(dom));
check('渲染出了模型对比行', /id="modelBody"[\s\S]{0,60000}?<tr>/.test(dom));
check('模型下拉框有选项', /id="modelSelect"[\s\S]{0,4000}?<option/.test(dom));
check('启动遮罩未显示错误', !/id="boot"[^>]*>[\s\S]{0,2000}?词表加载失败/.test(dom));
check('统计区未显示编码错误', !/id="stats"[\s\S]{0,3000}?编码出错/.test(dom));
check('高亮层有 token span', /class="tok/.test(dom));
check('没有 undefined / NaN 泄漏', !/>undefined</.test(dom) && !/>NaN</.test(dom));

// 提取 hero 数字
const m = dom.match(/<div class="stat hero"[^>]*>[\s\S]*?<div class="k">([^<]*)<\/div>[\s\S]*?<div class="v">([\s\S]*?)<\/div>/);
check('hero 统计项解析', !!m, m ? m[1] + ' = ' + m[2].replace(/<[^>]*>/g, '') : 'not found');
check('已加载 6 套词表', /已加载 6 套真实词表/.test(dom));

let fails = 0;
for (const c of checks) {
  if (!c.pass) fails++;
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.extra ? '  [' + c.extra + ']' : ''}`);
}
console.log('\nDOM 大小: ' + dom.length + ' bytes -> build/dom_dump.html');
console.log(fails === 0 ? 'BROWSER TEST: ALL PASS' : `BROWSER TEST: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
