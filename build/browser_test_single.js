/* 单文件版测试：以 file:// 直接打开，模拟双击离线使用 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const file = path.resolve(__dirname, '..', 'Token计算器-单文件版.html');
const URL = 'file:///' + file.replace(/\\/g, '/');
const PROFILE = path.join(process.env.TEMP, 'edge-token-single');

const args = [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files',
  '--user-data-dir=' + PROFILE, '--virtual-time-budget=30000',
  '--dump-dom', URL
];

const r = spawnSync(EDGE, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 });
const dom = r.stdout || '';
fs.writeFileSync(path.join(__dirname, 'dom_single.html'), dom);

const checks = [];
const check = (n, c, e) => checks.push({ n, pass: !!c, e: e === undefined ? '' : String(e) });

check('单文件页面能打开', dom.length > 2000, dom.length + ' bytes');
// 注意：inlined JS 源码里本身含有 '词表加载失败' / '<div class="msg err">' 等字符串，
// 直接搜 DOM 文本会误报。这里只检查「真正渲染出来的错误区域」：
//   - boot 遮罩里是否被 showBootError 塞进了错误内容（会包含 "词表加载失败" 文本节点）
//   - #stats 里是否渲染出编码错误
check('启动遮罩未显示错误', !/id="boot"[^>]*>[\s\S]{0,2000}?词表加载失败/.test(dom));
check('统计区未显示编码错误', !/id="stats"[\s\S]{0,3000}?编码出错/.test(dom));
check('词表加载遮罩已隐藏', /id="boot" class="[^"]*hide/.test(dom));
check('显示已加载词表数量', /已加载 6 套真实词表/.test(dom));
check('统计卡片已渲染', /class="stat/.test(dom));
check('token 高亮已渲染', /class="tok/.test(dom));
check('模型对比表已填充', /id="modelBody"[\s\S]{0,80000}?<tr>/.test(dom));
check('成本表已填充', /id="costBody"[\s\S]{0,20000}?<tr>/.test(dom));

const m = dom.match(/<div class="stat hero"[^>]*>[\s\S]*?<div class="k">([^<]*)<\/div>[\s\S]*?<div class="v">([\s\S]*?)<\/div>/);
check('主统计项 = 53（与官方 tokenizer 一致）', m && m[2].replace(/<[^>]*>/g, '').trim().startsWith('53'),
  m ? m[2].replace(/<[^>]*>/g, '').trim() : 'not found');

let fails = 0;
for (const c of checks) { if (!c.pass) fails++; console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.n}${c.e ? '  [' + c.e + ']' : ''}`); }
console.log('\n' + (fails === 0 ? 'SINGLE-FILE TEST: ALL PASS' : `SINGLE-FILE TEST: ${fails} FAILED`));
process.exit(fails === 0 ? 0 : 1);
