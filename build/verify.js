/* 精确性校验：逐个编码、逐条语料与官方库比对 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = path.dirname(__dirname);
const TokenKit = require(path.join(root, 'src', 'encoder.js'));

const which = process.argv[2] || 'corpus';      // corpus | fuzz
const file = which === 'fuzz' ? 'fuzz_expected.json' : 'expected.json';
const exp = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
const b64 = fs.readFileSync(path.join(__dirname, 'tokenizer_data.b64'), 'ascii').trim();
const bundle = TokenKit.parseBundle(new Uint8Array(zlib.gunzipSync(Buffer.from(b64, 'base64'))));

console.log(`数据源: ${file}  语料 ${exp.corpus.length} 条  编码 ${Object.keys(exp.expected).length} 种\n`);

let total = 0, bad = 0;
const samples = [];

for (const name of Object.keys(exp.expected)) {
  if (!bundle[name]) { console.log(`SKIP  ${name} (数据包中没有该编码)`); continue; }
  const enc = new TokenKit.Encoder(bundle[name]);
  const want = exp.expected[name];
  let localBad = 0;
  for (let i = 0; i < exp.corpus.length; i++) {
    total++;
    let got;
    // 默认开启特殊 token 识别，与 HF tokenizers 的默认行为一致
    try { got = enc.encode(exp.corpus[i]).ids.length; }
    catch (e) { got = 'ERR:' + e.message; }
    if (got !== want[i]) {
      localBad++; bad++;
      if (samples.length < 15) samples.push({ name, i, text: exp.corpus[i].slice(0, 56), got, want: want[i] });
    }
  }
  const n = exp.corpus.length;
  console.log(`${localBad === 0 ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} ${n - localBad}/${n}`);
}

// 只在 corpus 模式做往返解码检查（fuzz 里含有特殊 token 文本）
if (which === 'corpus') {
  console.log('\n--- 往返解码 decodeIds(encode(x)) === x ---');
  for (const name of Object.keys(bundle)) {
    const enc = new TokenKit.Encoder(bundle[name]);
    let ok = 0, k = 0;
    for (const text of exp.corpus) {
      k++;
      try {
        const ids = enc.encode(text, { specials: false }).ids;
        // Qwen 会做 NFC 规范化，规范化会改变原文，故以规范化后的文本比较
        const norm = enc.normalizer === 'NFC' ? text.normalize('NFC') : text;
        if (enc.decodeIds(ids) === norm) ok++;
      } catch (e) { /* 计入失败 */ }
    }
    console.log(`${ok === k ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} ${ok}/${k}`);
  }
}

console.log('\n--- 缓存与确定性 ---');
{
  const enc = new TokenKit.Encoder(bundle.deepseek);
  const s = '缓存与确定性测试 cache test 中文 12345 😀';
  const a = enc.encode(s).ids.join(',');
  let stable = true;
  for (let i = 0; i < 50; i++) if (enc.encode(s).ids.join(',') !== a) stable = false;
  console.log(`${stable ? 'PASS' : 'FAIL'}  反复编码结果稳定`);
}

if (samples.length) {
  console.log('\n--- 不一致样例 ---');
  samples.forEach(s => console.log(' ', JSON.stringify(s)));
}
console.log(`\n合计: ${total - bad}/${total} 完全一致`);
process.exit(bad === 0 ? 0 : 1);
