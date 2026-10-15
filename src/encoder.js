/*
 * Token 计算器 —— 离线精确的 token 计数与 API 成本估算工具
 * Copyright (C) 2026 HeSheng114514
 *
 * 本程序是自由软件：您可以依据自由软件基金会发布的 GNU 通用公共许可证
 * （GPL-3.0）的条款重新发布和/或修改它。
 *
 * 本程序希望有用，但不提供任何担保，甚至不包含适销性或特定用途适用性的
 * 默示担保。详见 GNU 通用公共许可证。
 */

/**
 * TokenKit —— 纯前端、离线的精确 BPE 分词引擎
 * ---------------------------------------------------------------------------
 * 支持四种真实词表，分词结果与官方 tokenizer 完全一致（非估算）：
 *   deepseek : DeepSeek-V3 / R1 系列（128k 词表，ByteLevel + 中文/数字分步预分词）
 *   qwen     : Qwen2.5 / Qwen3 系列（151k 词表）
 *   cl100k   : OpenAI GPT-4 / GPT-3.5 / text-embedding-3（100k 词表）
 *   o200k    : OpenAI GPT-4o / GPT-5 系列（200k 词表）
 *
 * 算法：先按各家官方正则做预切分（pre-tokenization），再对每段做
 * 字节级 BPE 合并（每次合并当前 rank 最小的一对），与 HF tokenizers /
 * tiktoken 的实现一致。词表数据以 gzip+base64 的形式内嵌在页面里。
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 一、预切分正则（严格照抄各家 tokenizer 的原文）
   * ------------------------------------------------------------------ */
  const PATTERNS = {
    // DeepSeek：数字 1~3 位一段 → 中日文一段 → 主规则
    dsNum: '\\p{N}{1,3}',
    dsCJK: '[\\u4e00-\\u9fa5\\u3040-\\u309f\\u30a0-\\u30ff]+',
    dsMain:
      '[!"#$%&\'()*+,\\-./:;<=>?@\\[\\\\\\]^_\x60{|}~][A-Za-z]+' +
      '|[^\\r\\n\\p{L}\\p{P}\\p{S}]?[\\p{L}\\p{M}]+' +
      '| ?[\\p{P}\\p{S}]+[\\r\\n]*' +
      '|\\s*[\\r\\n]+' +
      '|\\s+(?!\\S)' +
      '|\\s+',
    // Qwen：英文缩写 + 字母 + 单个数字 + 符号
    // (?i:'s|'t|...) 展开成显式大小写，避免依赖 ES2025 的 regex modifier 语法
    qwen:
      "(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])" +
      '|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+' +
      '|\\p{N}' +
      '| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*' +
      '|\\s*[\\r\\n]+' +
      '|\\s+(?!\\S)' +
      '|\\s+',
    // 智谱 GLM-5 / GLM-4.6（数字 1~3 位一段 + 字母/符号）
    glm:
      "(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])" +
      '|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+' +
      '|\\p{N}{1,3}' +
      '| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*' +
      '|\\s*[\\r\\n]+' +
      '|\\s+(?!\\S)' +
      '|\\s+',
    // Qwen3.8（24.8 万词表；字母分支含组合标记 \p{M}，数字为单个）
    qwen38:
      "(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])" +
      '|[^\\r\\n\\p{L}\\p{N}]?[\\p{L}\\p{M}]+' +
      '|\\p{N}' +
      '| ?[^\\s\\p{L}\\p{M}\\p{N}]+[\\r\\n]*' +
      '|\\s*[\\r\\n]+' +
      '|\\s+(?!\\S)' +
      '|\\s+',
    // OpenAI cl100k_base（tiktoken 官方 pat_str，逐字对应）
    // 注意首支是「撇号 + 缩写」'(?i:[sdmt]|ll|ve|re)，撇号不能丢，
    // 否则 'The' 会被拆成 'T'+'he'。
    cl100k:
      "(?:'[sS]|'[tT]|'[mM]|'[dD]|'[lL][lL]|'[vV][eE]|'[rR][eE])" +
      '|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+' +
      '|\\p{N}{1,3}' +
      '| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*' +
      '|\\s+$' +
      '|\\s*[\\r\\n]' +
      '|\\s+(?!\\S)' +
      '|\\s',
    // OpenAI o200k_base（tiktoken 官方 pat_str）
    o200k:
      '[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+(?:' + "'" + '[sS]|' + "'" + '[tT]|' + "'" + '[rR][eE]|' + "'" + '[vV][eE]|' + "'" + '[mM]|' + "'" + '[lL][lL]|' + "'" + '[dD])?' +
      '|[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*(?:' + "'" + '[sS]|' + "'" + '[tT]|' + "'" + '[rR][eE]|' + "'" + '[vV][eE]|' + "'" + '[mM]|' + "'" + '[lL][lL]|' + "'" + '[dD])?' +
      '|\\p{N}{1,3}' +
      '| ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*' +
      '|\\s*[\\r\\n]+' +
      '|\\s+(?!\\S)' +
      '|\\s+'
  };

  // 每种词表的预切分步骤（按顺序串联）
  const RECIPES = {
    deepseek: [PATTERNS.dsNum, PATTERNS.dsCJK, PATTERNS.dsMain],
    qwen: [PATTERNS.qwen],
    qwen38: [PATTERNS.qwen38],
    glm: [PATTERNS.glm],
    cl100k: [PATTERNS.cl100k],
    o200k: [PATTERNS.o200k]
  };

  // 每种词表在预切分之前做的 Unicode 规范化（对应 tokenizer.json 里的 normalizer）
  // DeepSeek 是空的 Sequence；Qwen（含 3.8）声明为 NFC（组合字符会被合成，
  // 例如 "e\u0301" -> "é"，分词结果随之不同）；GLM 与 OpenAI 不做规范化。
  const NORMALIZERS = {
    deepseek: 'none',
    qwen: 'NFC',
    qwen38: 'NFC',
    glm: 'none',
    cl100k: 'none',
    o200k: 'none'
  };

  /**
   * 对应 tokenizer.json 里的 ignore_merges。
   * 智谱 GLM-5 设为 true：预切分后如果整个片段恰好命中词表，就直接作为
   * 一个 token 输出，不再做 BPE 合并。GLM 的词表 id 与合并顺序并不单调
   * （合并表里有大量重复项），只有按这个规则才能与官方完全一致。
   */
  const IGNORE_MERGES = {
    glm: true
  };

  const COMPILED = {};
  function recipeOf(name) {
    if (!COMPILED[name]) {
      COMPILED[name] = RECIPES[name].map(function (p) {
        return new RegExp(p, 'gu');
      });
    }
    return COMPILED[name];
  }

  /* ------------------------------------------------------------------ *
   * 二、工具函数
   * ------------------------------------------------------------------ */
  const utf8Decoder = new TextDecoder('utf-8');
  const utf8Encoder = new TextEncoder();

  /** 字节数组 → latin1 字符串（仅用于做 Map 的 key，速度快且无歧义） */
  function latin1(bytes, from, to) {
    from = from || 0;
    to = to === undefined ? bytes.length : to;
    let s = '';
    for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 用正则做一次「匹配段 / 空隙段」交替的切分，返回 {value,start,end} 序列。
   * value=null 表示该段未被任何分支命中（空隙），仍需保留字符范围，
   * 因为官方实现（tiktoken 的 findall 之间、HF 的 Split 之后）这些字符
   * 依然会进入编码流程。
   */
  function splitIsolated(s, re) {
    const out = [];
    let last = 0;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) out.push({ value: null, start: last, end: m.index });
      out.push({ value: m[0], start: m.index, end: m.index + m[0].length });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ value: null, start: last, end: s.length });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 三、数据解析：TOK1 二进制格式
   * ------------------------------------------------------------------ */
  function parseBundle(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8[0] !== 0x54 || u8[1] !== 0x4f || u8[2] !== 0x4b || u8[3] !== 0x31) {
      throw new Error('词表数据格式不正确（magic != TOK1）');
    }
    let p = 4;
    const n = u8[p++];
    const out = {};
    for (let e = 0; e < n; e++) {
      const nl = u8[p++];
      let name = '';
      for (let i = 0; i < nl; i++) name += String.fromCharCode(u8[p + i]);
      p += nl;

      const idOffset = dv.getUint16(p, true); p += 2;
      const count = dv.getUint32(p, true); p += 4;
      const nSpec = dv.getUint32(p, true); p += 4;

      const specials = [];
      for (let s = 0; s < nSpec; s++) {
        const id = dv.getUint32(p, true); p += 4;
        const len = dv.getUint16(p, true); p += 2;
        specials.push({ id: id, text: utf8Decoder.decode(u8.subarray(p, p + len)) });
        p += len;
      }
      // 长 token 优先匹配，避免短特殊 token 抢先命中
      specials.sort(function (a, b) { return b.text.length - a.text.length; });

      const tokens = new Array(count);
      const rankOf = new Map();
      for (let i = 0; i < count; i++) {
        const len = dv.getUint16(p, true); p += 2;
        if (len === 0) { tokens[i] = null; continue; }
        const bytes = u8.subarray(p, p + len);
        p += len;
        tokens[i] = bytes;
        rankOf.set(latin1(bytes), i + idOffset);
      }

      out[name] = {
        name: name,
        idOffset: idOffset,
        count: count,
        tokens: tokens,
        rankOf: rankOf,
        specials: specials
      };
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 四、编码器
   * ------------------------------------------------------------------ */
  const MERGE_CACHE_LIMIT = 60000;

  function Encoder(blob) {
    this.name = blob.name;
    this.idOffset = blob.idOffset;
    this.tokens = blob.tokens;
    this.rankOf = blob.rankOf;
    this.specials = blob.specials;
    this.steps = recipeOf(blob.name);
    this.normalizer = NORMALIZERS[blob.name] || 'none';
    this.ignoreMerges = !!IGNORE_MERGES[blob.name];
    this.cache = new Map();
    this.specialRe = null;
    if (blob.specials.length) {
      const alt = blob.specials
        .map(function (s) { return escapeRegExp(s.text); })
        .join('|');
      this.specialRe = new RegExp(alt, 'g');
      this.specialMap = new Map();
      blob.specials.forEach(function (s) { this.specialMap.set(s.text, s.id); }, this);
    } else {
      this.specialMap = new Map();
    }
    this.hasSpecials = blob.specials.length > 0;
  }

  /** 单段字节 → token id 序列（含每个 token 在字节流中的区间） */
  Encoder.prototype._bpe = function (bytes) {
    // ignore_merges：整段直接命中词表时，不再走合并流程
    if (this.ignoreMerges) {
      const direct = this.rankOf.get(latin1(bytes));
      if (direct !== undefined) {
        return [{ id: direct, b0: 0, b1: bytes.length }];
      }
    }
    const key = latin1(bytes);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const rankOf = this.rankOf;
    const n = bytes.length;
    const starts = [];
    const ranks = [];

    // 取的是一对「已被合并后的相邻分区」在字节流中的区间 [pairStart, pairEnd)
    function getRank(startIndex) {
      const pairStart = starts[startIndex];
      const pairEnd = starts[startIndex + 2];
      if (pairEnd === undefined) return Infinity; // 没有成对的分区了
      const r = rankOf.get(latin1(bytes, pairStart, pairEnd));
      return r === undefined ? Infinity : r;
    }

    for (let i = 0; i <= n; i++) {
      starts.push(i);
      if (i < n - 1) {
        // 初始化时用原始字节区间 [i, i+2)，此时 starts 还没建完，不能走 getRank
        const r = rankOf.get(latin1(bytes, i, i + 2));
        ranks.push(r === undefined ? Infinity : r);
      } else {
        ranks.push(Infinity);
      }
    }

    // 每轮合并当前 rank 最小的一对，直到没有可合并的
    while (starts.length > 1) {
      let lowest = Infinity;
      let idx = -1;
      for (let i = 0; i < ranks.length - 1; i++) {
        if (ranks[i] < lowest) { lowest = ranks[i]; idx = i; }
      }
      if (lowest === Infinity || idx === -1) break;
      starts.splice(idx + 1, 1);
      ranks.splice(idx, 1);
      ranks[idx] = getRank(idx);
      if (idx > 0) ranks[idx - 1] = getRank(idx - 1);
    }

    const out = [];
    for (let i = 0; i < starts.length - 1; i++) {
      const a = starts[i];
      const b = starts[i + 1];
      out.push({ id: rankOf.get(latin1(bytes, a, b)), b0: a, b1: b });
    }

    if (this.cache.size >= MERGE_CACHE_LIMIT) this.cache.clear();
    this.cache.set(key, out);
    return out;
  };

  /**
   * 编码文本。
   * @returns {{ids:number[], pieces:Array}} pieces 含每个 token 的文本与字符区间
   */
  Encoder.prototype.encode = function (text, opts) {
    opts = opts || {};
    const recognizeSpecial = opts.specials !== false && this.hasSpecials;
    const pieces = [];
    const ids = [];

    // 规范化（会改变字符数，因此规范化后 token 的字符区间是相对规范化文本的；
    // 高亮展示用规范化后的文本即可，二者一致）
    let norm = text;
    if (this.normalizer === 'NFC') norm = text.normalize('NFC');
    else if (this.normalizer === 'NFD') norm = text.normalize('NFD');
    else if (this.normalizer === 'NFKC') norm = text.normalize('NFKC');

    const segments = recognizeSpecial ? this._splitSpecials(norm) : [{ text: norm, special: false, start: 0 }];

    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      if (seg.special) {
        const id = seg.id;
        ids.push(id);
        pieces.push({ id: id, text: seg.text, start: seg.start, end: seg.start + seg.text.length, kind: 'special' });
        continue;
      }
      // 预切分（每一步都保留绝对字符偏移；未被任何分支命中的字符作为
      // 「空隙」片段继续传给下一步，最后仍要参与编码，否则字节流会缺失）
      let parts = [{ value: seg.text, start: seg.start }];
      for (let k = 0; k < this.steps.length; k++) {
        const re = this.steps[k];
        const next = [];
        for (let i = 0; i < parts.length; i++) {
          const piece = parts[i];
          const sub = splitIsolated(piece.value, re);
          for (let j = 0; j < sub.length; j++) {
            const it = sub[j];
            next.push({
              value: it.value === null ? piece.value.slice(it.start, it.end) : it.value,
              start: piece.start + it.start
            });
          }
        }
        parts = next;
      }
      // 逐段做 BPE；空隙片段（value=null，即所有分支都没覆盖的字符）不计入
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part.value) continue;
        const text = part.value;
        const bytes = utf8Encoder.encode(text);
        const toks = this._bpe(bytes);
        // 段内每个字符的起始字节偏移 -> 字符索引（升序，可线性/二分查找）
        const byteStarts = [];
        const charStarts = [];
        let bp = 0;
        for (let c = 0; c < text.length;) {
          byteStarts.push(bp);
          charStarts.push(c);
          const cp = text.codePointAt(c);
          const clen = cp > 0xffff ? 2 : 1;
          bp += utf8Encoder.encode(text.slice(c, c + clen)).length;
          c += clen;
        }
        byteStarts.push(bp);
        charStarts.push(text.length);
        // 字节偏移 -> 字符偏移；落在多字节字符内部时向前取该字符起点
        const charOf = function (b) {
          let lo = 0;
          let hi = byteStarts.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (byteStarts[mid] <= b) lo = mid; else hi = mid - 1;
          }
          return charStarts[lo];
        };
        for (let t = 0; t < toks.length; t++) {
          const tk = toks[t];
          const c0 = charOf(tk.b0);
          let c1 = charOf(tk.b1);
          if (c1 <= c0) c1 = c0 + 1;
          ids.push(tk.id);
          pieces.push({
            id: tk.id,
            text: text.slice(c0, c1),
            start: part.start + c0,
            end: part.start + c1,
            kind: 'bpe'
          });
        }
      }
    }
    return { ids: ids, pieces: pieces };
  };

  /** 把文本按特殊 token 切成段落 */
  Encoder.prototype._splitSpecials = function (text) {
    const re = this.specialRe;
    re.lastIndex = 0;
    const out = [];
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > last) out.push({ text: text.slice(last, m.index), special: false, start: last });
      out.push({ text: m[0], special: true, id: this.specialMap.get(m[0]), start: m.index });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last), special: false, start: last });
    return out;
  };

  Encoder.prototype.count = function (text, opts) {
    return this.encode(text, opts).ids.length;
  };

  /** token id → 文本 */
  Encoder.prototype.decodeIds = function (idList) {
    const chunks = [];
    let buf = [];
    for (let i = 0; i < idList.length; i++) {
      const id = idList[i];
      const t = this.tokens[id - this.idOffset];
      if (t) buf.push(t);
    }
    // 合并后一次性 UTF-8 解码，正确处理被切开的多字节字符
    let total = 0;
    for (let i = 0; i < buf.length; i++) total += buf[i].length;
    const all = new Uint8Array(total);
    let o = 0;
    for (let i = 0; i < buf.length; i++) { all.set(buf[i], o); o += buf[i].length; }
    return utf8Decoder.decode(all);
  };

  Encoder.prototype.tokenBytes = function (id) {
    return this.tokens[id - this.idOffset] || null;
  };

  Encoder.prototype.tokenText = function (id) {
    const t = this.tokenBytes(id);
    return t ? utf8Decoder.decode(t) : '';
  };

  /* ------------------------------------------------------------------ *
   * 五、对外接口
   * ------------------------------------------------------------------ */
  const api = {
    parseBundle: parseBundle,
    Encoder: Encoder,
    PATTERNS: PATTERNS,
    /** 解压内嵌的 gzip+base64 词表 */
    loadFromBase64: function (b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (typeof DecompressionStream === 'undefined') {
        return Promise.reject(new Error('当前浏览器不支持 DecompressionStream，请升级浏览器'));
      }
      const ds = new DecompressionStream('gzip');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Response(stream).arrayBuffer().then(function (ab) {
        return parseBundle(new Uint8Array(ab));
      });
    }
  };

  global.TokenKit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
