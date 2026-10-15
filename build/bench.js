const fs=require('fs'),path=require('path'),zlib=require('zlib');
const TK=require(path.join(__dirname,'..','src','encoder.js'));
const b64=fs.readFileSync(path.join(__dirname,'tokenizer_data.b64'),'ascii').trim();
console.time('解压+解析 6 套词表');
const bundle=TK.parseBundle(new Uint8Array(zlib.gunzipSync(Buffer.from(b64,'base64'))));
console.timeEnd('解压+解析 6 套词表');
const zh='人工智能正在改变世界，大语言模型的应用越来越广泛。'.repeat(100);
const en='The quick brown fox jumps over the lazy dog. '.repeat(100);
const mixed=(zh+en).repeat(4);
const code=('function fib(n){return n<2?n:fib(n-1)+fib(n-2);}\n').repeat(300);
for (const n of Object.keys(bundle)) {
  const e=new TK.Encoder(bundle[n]);
  e.encode(mixed); // 预热
  let t0=Date.now(); const c1=e.encode(mixed).ids.length; const t1=Date.now();
  let t2=Date.now(); const c2=e.encode(code).ids.length; const t3=Date.now();
  const kcharsPerSec = Math.round(mixed.length/((t1-t0)||1));
  console.log(`${n.padEnd(9)} 混合文本 ${String(mixed.length).padStart(8)}字符 ${String(c1).padStart(6)}token ${String(t1-t0).padStart(5)}ms (${kcharsPerSec}k字符/秒) | 代码 ${String(c2).padStart(5)}token ${String(t3-t2).padStart(4)}ms`);
}
console.log('\n词汇规模:', Object.keys(bundle).map(k=>`${k}=${bundle[k].count.toLocaleString()}`).join('  '));
