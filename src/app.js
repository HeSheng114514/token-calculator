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

/* ===========================================================================
 * Token 计算器 —— 应用逻辑
 * 分词引擎见 encoder.js（离线、精确），模型与价格见 models.js
 * ======================================================================== */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const LS_KEY = 'token-calc-v1';

  const PALETTE = [
    '#5b9cff', '#7c5cff', '#35d0a5', '#ffb340', '#ff6b6b',
    '#3fc1c9', '#e069c4', '#8fbf3f', '#ff8f5e', '#6f8cff',
    '#c05cff', '#2fbf9c', '#f2c14e', '#ef6f8f', '#59a5f5'
  ];

  /* ---------------------------------------------------------------- 状态 */
  const state = {
    encoders: {},          // encoding id -> Encoder
    ready: false,
    text: '',
    encoding: 'deepseek',
    modelId: 'deepseek-chat',
    showHighlight: true,
    theme: 'dark',
    rate: 7.1,             // USD -> CNY，仅用于展示换算
    customPrices: {},      // modelId -> {in,out,cacheIn}
    customModels: [],
    cacheHit: 0,
    outputTokens: 500,
    calls: 1,
    offPeak: false,
    rawInfo: null,
    result: null,
    filter: ''
  };

  /* ------------------------------------------------------------ 持久化 */
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      ['encoding', 'modelId', 'showHighlight', 'theme', 'rate', 'customPrices',
       'customModels', 'cacheHit', 'outputTokens', 'calls', 'offPeak'].forEach(function (k) {
        if (p[k] !== undefined) state[k] = p[k];
      });
    } catch (e) { /* 忽略损坏的本地数据 */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        encoding: state.encoding, modelId: state.modelId,
        showHighlight: state.showHighlight, theme: state.theme, rate: state.rate,
        customPrices: state.customPrices, customModels: state.customModels,
        cacheHit: state.cacheHit, outputTokens: state.outputTokens, calls: state.calls,
        offPeak: state.offPeak
      }));
    } catch (e) { /* 隐私模式下可能失败，忽略 */ }
  }

  /* ------------------------------------------------------------- 工具 */
  const UTF8 = new TextEncoder();
  let byteCacheText = null;
  let byteCacheVal = 0;

  /** UTF-8 字节数（带一层缓存，避免重复编码大文本） */
  function utf8Bytes(s) {
    if (byteCacheText === s) return byteCacheVal;
    byteCacheVal = UTF8.encode(s).length;
    byteCacheText = s;
    return byteCacheVal;
  }

  /**
   * 非当前分词器下的 token 数缓存。
   * 模型对比表 / CSV 导出都会用到，避免每次键入都把所有词表重算一遍。
   */
  let countCacheKey = null;
  const countCache = {};
  function tokenCountFor(encoding, text) {
    if (countCacheKey !== text) {
      countCacheKey = text;
      Object.keys(countCache).forEach(function (k) { delete countCache[k]; });
    }
    if (countCache[encoding] === undefined) {
      const enc = state.encoders[encoding];
      if (!enc) return 0;
      countCache[encoding] = enc.count(text, { specials: false });
    }
    return countCache[encoding];
  }

  function fmtInt(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('zh-CN');
  }

  function fmtNum(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const d = digits === undefined ? 2 : digits;
    return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /** 金额：很小的值用更多小数位，避免显示成 0.00 */
  function fmtMoney(n) {
    if (!isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a === 0) return '0.00';
    if (a < 0.0001) return n.toExponential(2);
    if (a < 0.01) return n.toFixed(6);
    if (a < 1) return n.toFixed(4);
    return n.toFixed(2);
  }

  function allModels() {
    return MODELS.concat(state.customModels);
  }

  function modelById(id) {
    return allModels().filter(function (m) { return m.id === id; })[0] || allModels()[0];
  }

  function priceOf(m) {
    const override = state.customPrices[m.id];
    const base = m.price || { in: 0, out: 0 };
    const useOffPeak = state.offPeak && m.offPeak;
    const src = useOffPeak ? m.offPeak : base;
    const fallback = {
      in: src.in !== undefined ? src.in : base.in,
      out: src.out !== undefined ? src.out : base.out,
      cacheIn: src.cacheIn !== undefined ? src.cacheIn
        : (base.cacheIn !== undefined ? base.cacheIn : base.in)
    };
    return {
      in: override && override.in !== undefined ? override.in : fallback.in,
      out: override && override.out !== undefined ? override.out : fallback.out,
      cacheIn: override && override.cacheIn !== undefined ? override.cacheIn : fallback.cacheIn,
      currency: base.currency || 'USD',
      offPeakApplied: !!(useOffPeak && !override)
    };
  }

  /* ==================================================================
   * 一、启动
   * ================================================================== */
  function boot() {
    loadPrefs();
    applyTheme();
    renderModelSelect();

    if (typeof TokenKit === 'undefined') {
      showBootError('分词引擎脚本未能加载（src/encoder.js）。');
      return;
    }
    // 单文件版本会把词表内联在 window.__TOKEN_DATA__；
    // 分文件版本则从 build/tokenizer_data.b64 读取。
    const inline = typeof window.__TOKEN_DATA__ === 'string' ? window.__TOKEN_DATA__ : null;

    const loader = inline
      ? TokenKit.loadFromBase64(inline)
      : fetch('build/tokenizer_data.b64')
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
          })
          .then(function (t) { return TokenKit.loadFromBase64(t.trim()); });

    loader.then(function (bundle) {
      Object.keys(bundle).forEach(function (id) {
        state.encoders[id] = new TokenKit.Encoder(bundle[id]);
      });
      state.ready = true;
      $('#boot').classList.add('hide');
      setTimeout(function () { $('#boot').style.display = 'none'; }, 320);

      $('#engineInfo').textContent = '已加载 ' + Object.keys(bundle).length + ' 套真实词表';
      if (!state.encoders[state.encoding]) state.encoding = Object.keys(bundle)[0];
      initFormValues();
      seedDefaultText();
      bindEditor();
      recompute();
    }).catch(function (err) {
      showBootError('词表加载失败：' + err.message);
    });
  }

  /** 把持久化的状态回填到各个输入控件 */
  function initFormValues() {
    $('#outputTokens').value = state.outputTokens;
    const range = $('#outputRange');
    if (state.outputTokens > Number(range.max)) range.max = state.outputTokens;
    range.value = state.outputTokens;
    $('#calls').value = state.calls;
    $('#rate').value = state.rate;
    $('#rateVal').textContent = state.rate;
    $('#cacheHit').value = state.cacheHit;
    $('#cacheHitVal').textContent = state.cacheHit + '%';
    $('#hlToggle').textContent = state.showHighlight ? '隐藏 token 颜色' : '显示 token 颜色';
    $('#hlToggle').classList.toggle('primary', state.showHighlight);
    syncFormFromState();
  }

  function showBootError(msg) {
    const b = $('#boot');
    if (!b) return;
    b.innerHTML = '<div class="msg err" style="max-width:560px">' + escapeHtml(msg) +
      '<br><br>若您单独打开了 <span class="mono">index.html</span>，请确认 ' +
      '<span class="mono">build/tokenizer_data.b64</span> 与 ' +
      '<span class="mono">src/*.js</span> 都在同一目录下（或改用单文件版）。</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function seedDefaultText() {
    const ed = $('#editor');
    if (!ed.value) {
      ed.value = '你好，世界！Hello, world! 12345\n\n' +
        'Token 计算器可以精确统计文本的 token 数量，\n' +
        '并估算 API 调用成本。It supports multiple encodings.\n\n' +
        'def greet(name):\n    return f"Hello, {name}!"';
    }
    state.text = ed.value;
  }

  /* ==================================================================
   * 二、编辑器与高亮
   * ================================================================== */
  let debounceTimer = null;

  function bindEditor() {
    const ed = $('#editor');

    ed.addEventListener('input', function () {
      state.text = ed.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recompute, 90);
    });
    ed.addEventListener('scroll', syncScroll);
    ed.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {   // 允许 Tab 缩进而不是跳焦点
        e.preventDefault();
        const s = ed.selectionStart, t = ed.selectionEnd;
        ed.value = ed.value.slice(0, s) + '    ' + ed.value.slice(t);
        ed.selectionStart = ed.selectionEnd = s + 4;
        state.text = ed.value;
        recompute();
      }
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () { syncScroll(); }).observe(ed);
    }
    window.addEventListener('resize', syncScroll);
    syncScroll();
  }

  function syncScroll() {
    const ed = $('#editor');
    const hl = $('#highlight');
    const inner = $('#hlInner');
    if (!ed || !hl || !inner) return;
    hl.style.width = ed.clientWidth + 'px';
    hl.style.height = ed.clientHeight + 'px';
    hl.style.left = ed.offsetLeft + 'px';
    hl.style.top = ed.offsetTop + 'px';
    inner.style.transform = 'translate(' + (-ed.scrollLeft) + 'px,' + (-ed.scrollTop) + 'px)';
  }

  /** 渲染 token 高亮（对超大文本做数量上限保护） */
  function renderHighlight(pieces) {
    const wrap = $('#editorWrap');
    const inner = $('#hlInner');
    if (!state.showHighlight) {
      wrap.classList.remove('hl-mode');
      inner.innerHTML = '';
      return;
    }
    wrap.classList.add('hl-mode');

    const LIMIT = 20000;
    if (pieces.length > LIMIT) {
      inner.textContent = state.text;
      $('#hlNote').textContent = 'token 数超过 ' + LIMIT.toLocaleString() +
        '，已暂停彩色高亮以保证流畅（计数仍然精确）。';
      $('#hlNote').classList.remove('hidden');
      return;
    }
    $('#hlNote').classList.add('hidden');

    const freq = new Map();
    pieces.forEach(function (p) { freq.set(p.id, (freq.get(p.id) || 0) + 1); });
    const colorOf = new Map();
    // 按出现频次降序分配颜色，让高频 token 的颜色更稳定
    Array.from(freq.entries()).sort(function (a, b) { return b[1] - a[1]; })
      .forEach(function (e, i) { colorOf.set(e[0], PALETTE[i % PALETTE.length]); });

    const parts = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const c = colorOf.get(p.id);
      const special = p.kind === 'special';
      parts.push(
        '<span class="tok' + (special ? ' special' : '') + '" ' +
        'style="background:' + hexToRgba(c, special ? 0.4 : 0.22) + ';' +
        (special ? 'color:' + c : '') + '" ' +
        'title="' + escapeHtml(p.text) + ' → id ' + p.id + '">' +
        escapeHtml(p.text) + '</span>'
      );
    }
    // 末尾补一个换行，保证最后一行的高度与 textarea 一致
    inner.innerHTML = parts.join('') + '\n';
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ==================================================================
   * 三、核心计算
   * ================================================================== */
  function recompute() {
    if (!state.ready) return;
    const text = state.text || '';
    const enc = state.encoders[state.encoding];
    if (!enc) return;

    const t0 = performance.now();
    let res;
    try {
      res = enc.encode(text);
    } catch (err) {
      $('#stats').innerHTML = '<div class="msg err">编码出错：' + escapeHtml(err.message) + '</div>';
      return;
    }
    const ms = performance.now() - t0;

    state.result = res;
    renderHighlight(res.pieces);
    renderStats(text, res, ms);
    renderBreakdown(res.pieces);
    renderModelTable(res.ids.length);
    renderCost(res.ids.length);
    renderContext(res.ids.length);
    renderRawNote();
  }

  /** 拖入的文件若含 CR，输入框会把它转成 LF，这里如实提示真实差异 */
  function renderRawNote() {
    const el = $('#rawNote');
    if (!el) return;
    const info = state.rawInfo;
    if (!info) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const diff = info.rawTokens - info.lfTokens;
    if (diff === 0) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = '<div class="msg info">文件 <b>' + escapeHtml(info.name) +
      '</b> 含 ' + fmtInt(info.rawCR) + ' 个 CR（\\r）。浏览器输入框会把 CR/CRLF 统一成 LF，' +
      '因此上面的计数对应转换后的文本（' + fmtInt(info.lfTokens) + ' token）；' +
      '若按文件原始字节统计则为 <b>' + fmtInt(info.rawTokens) + ' token</b>（相差 ' +
      (diff > 0 ? '+' : '') + fmtInt(diff) + '）。</div>';
  }

  function renderStats(text, res, ms) {
    const chars = Array.from(text).length;
    const charsNoSpace = Array.from(text.replace(/\s/g, '')).length;
    const lines = text === '' ? 0 : text.split('\n').length;
    const bytes = utf8Bytes(text);
    const nTokens = res.ids.length;
    const nWords = (text.match(/[\p{L}\p{N}]+/gu) || []).length;
    const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const specials = res.pieces.filter(function (p) { return p.kind === 'special'; }).length;

    const perToken = nTokens ? chars / nTokens : 0;

    $('#stats').innerHTML =
      stat('hero', 'Token 数', fmtInt(nTokens), state.encoders[state.encoding].name) +
      stat('', '字符数', fmtInt(chars), '含空白') +
      stat('', '字符 / token', perToken ? fmtNum(perToken, 2) : '—', '平均') +
      stat('', 'UTF-8 字节', fmtInt(bytes), '') +
      stat('', '行数', fmtInt(lines), '') +
      stat('', '词 / 数字块', fmtInt(nWords), '') +
      stat('', '中日韩字符', fmtInt(cjk), '') +
      stat('', '特殊 token', fmtInt(specials), '') +
      stat('', '非空白字符', fmtInt(charsNoSpace), '') +
      stat('', '编码耗时', fmtNum(ms, 1) + ' ms', '');
  }

  function stat(cls, k, v, sub) {
    return '<div class="stat ' + cls + '"><div class="k">' + escapeHtml(k) + '</div>' +
      '<div class="v">' + v + (sub ? '<small>' + escapeHtml(sub) + '</small>' : '') + '</div></div>';
  }

  /* -------------------------------------------------- token 明细表 */
  function renderBreakdown(pieces) {
    const agg = new Map();
    pieces.forEach(function (p) {
      const cur = agg.get(p.id) || { id: p.id, text: p.text, bytes: 0, n: 0, kind: p.kind };
      cur.n++;
      cur.text = p.text;
      agg.set(p.id, cur);
    });
    const rows = Array.from(agg.values()).sort(function (a, b) { return b.n - a.n; }).slice(0, 60);
    const total = pieces.length || 1;

    const html = rows.map(function (r) {
      const pct = (r.n / total) * 100;
      const color = PALETTE[r.id % PALETTE.length];
      return '<tr>' +
        '<td class="num mono">' + r.id + '</td>' +
        '<td><span class="swatch" style="background:' + color + '"></span>' +
          '<span class="mono">' + escapeHtml(vis(r.text)) + '</span></td>' +
        '<td class="num">' + fmtInt(r.n) + '</td>' +
        '<td class="num">' + fmtNum(pct, 1) + '%</td>' +
        '<td style="min-width:90px"><span class="bar" style="width:' + Math.max(2, pct) + '%"></span></td>' +
        '</tr>';
    }).join('');

    $('#breakdownBody').innerHTML = html ||
      '<tr><td colspan="5" class="faint center">暂无内容</td></tr>';
    $('#breakdownMeta').textContent = pieces.length
      ? '共 ' + fmtInt(pieces.length) + ' 个 token / ' + fmtInt(agg.size) + ' 种，按出现次数排序'
      : '';
  }

  /** 把不可见字符可视化，便于理解 token 边界 */
  function vis(s) {
    return s
      .replace(/ /g, '␣')
      .replace(/\t/g, '⇥')
      .replace(/\n/g, '⏎')
      .replace(/\r/g, '␍');
  }

  /* -------------------------------------------------- 模型对比表 */
  function renderModelTable(inputTokens) {
    const list = allModels();
    const rows = list.map(function (m) {
      if (!state.encoders[m.encoding]) return null;
      let n;
      if (m.encoding === state.encoding) n = inputTokens;
      else n = tokenCountFor(m.encoding, state.text || '');
      const p = priceOf(m);
      const cost = (n / 1e6) * p.in + (state.outputTokens / 1e6) * p.out;
      return { m: m, n: n, cost: cost, p: p };
    }).filter(Boolean).filter(function (r) {
      if (!state.filter) return true;
      const q = state.filter.toLowerCase();
      return (r.m.label + ' ' + r.m.vendor + ' ' + r.m.id + ' ' + r.m.encoding).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return a.cost - b.cost; });

    const max = rows.reduce(function (a, r) { return Math.max(a, r.cost); }, 0) || 1;

    $('#modelBody').innerHTML = rows.map(function (r) {
      const m = r.m;
      const over = r.n > m.ctx;
      return '<tr>' +
        '<td><b>' + escapeHtml(m.label) + '</b>' +
          (m.approx ? ' <span class="pill warn" title="该厂商未公开词表，用体积相近的词表近似，token 数是估计值">≈</span>' : '') +
          '<div class="faint" style="font-size:11.5px">' +
          escapeHtml(m.vendor) + ' · ' + (ENCODINGS[m.encoding] ? ENCODINGS[m.encoding].label : m.encoding) +
          (m.approx ? '（近似）' : '') + '</div></td>' +
        '<td class="num">' + fmtInt(m.ctx) + '</td>' +
        '<td class="num">' + fmtInt(r.n) +
          (over ? ' <span class="pill bad">超限</span>' : '') + '</td>' +
        '<td class="num">' + fmtNum(r.p.in, 3) + '</td>' +
        '<td class="num">' + fmtNum(r.p.out, 3) + '</td>' +
        '<td class="num"><b>$' + fmtMoney(r.cost) + '</b>' +
          '<span class="bar" style="width:' + (r.cost / max * 100).toFixed(1) + '%"></span></td>' +
        '<td class="center"><button class="btn sm ghost" data-use-model="' + escapeHtml(m.id) +
          '">选用</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="7" class="faint center">没有匹配的模型</td></tr>';

    $('#modelMeta').textContent = rows.length + ' 个模型 · 按单次成本升序';
  }

  /* -------------------------------------------------- 成本计算 */
  function calcCost(m, inputTokens, outputTokens, cacheHit) {
    const p = priceOf(m);
    const hitTokens = inputTokens * cacheHit;
    const missTokens = inputTokens - hitTokens;
    const inCost = (missTokens / 1e6) * p.in + (hitTokens / 1e6) * p.cacheIn;
    const outCost = (outputTokens / 1e6) * p.out;
    return { inCost: inCost, outCost: outCost, total: inCost + outCost, p: p,
             hitTokens: hitTokens, missTokens: missTokens };
  }

  function renderCost(inputTokens) {
    const m = modelById(state.modelId);
    const out = Math.max(0, Number(state.outputTokens) || 0);
    const hit = Math.max(0, Math.min(1, (Number(state.cacheHit) || 0) / 100));
    const calls = Math.max(1, Math.round(Number(state.calls) || 1));
    const c = calcCost(m, inputTokens, out, hit);

    const p = c.p;
    const cny = p.currency === 'CNY' ? 1 : state.rate;

    $('#costModel').textContent = m.label + '（' + m.vendor + '）';
    const notes = [];
    if (p.offPeakApplied) notes.push('已按空闲时段半价');
    if (m.cny) notes.push('官方人民币价：输入 ¥' + m.cny.in + ' / 输出 ¥' + m.cny.out + ' / 百万 token');
    if (p.currency === 'CNY') notes.push('该模型原价即人民币');
    else notes.push('原价 USD，按 1 USD ≈ ' + state.rate + ' CNY 仅供参考');
    $('#costCurrencyNote').textContent = notes.join('；');

    $('#costBody').innerHTML =
      costRow('输入 · 未命中缓存', c.missTokens, p.in, (c.missTokens / 1e6) * p.in, cny) +
      costRow('输入 · 命中缓存', c.hitTokens, p.cacheIn, (c.hitTokens / 1e6) * p.cacheIn, cny) +
      costRow('输出', out, p.out, c.outCost, cny) +
      '<tr style="border-top:2px solid var(--line)">' +
        '<td><b>单次合计</b></td>' +
        '<td class="num">' + fmtInt(inputTokens + out) + '</td>' +
        '<td class="num faint">—</td>' +
        '<td class="num"><b>$' + fmtMoney(c.total) + '</b></td>' +
        '<td class="num"><b>¥' + fmtMoney(c.total * cny) + '</b></td>' +
      '</tr>' +
      '<tr>' +
        '<td><b>× ' + fmtInt(calls) + ' 次</b></td>' +
        '<td class="num faint">—</td><td class="num faint">—</td>' +
        '<td class="num"><b>$' + fmtMoney(c.total * calls) + '</b></td>' +
        '<td class="num"><b>¥' + fmtMoney(c.total * calls * cny) + '</b></td>' +
      '</tr>';

    // 大数字摘要
    const per1k = c.total * 1000;
    $('#costSummary').innerHTML =
      stat('hero', '单次成本', '$' + fmtMoney(c.total), '¥' + fmtMoney(c.total * cny)) +
      stat('', '每 1000 次', '$' + fmtMoney(per1k), '') +
      stat('', '输入成本占比', c.total ? fmtNum(c.inCost / c.total * 100, 1) + '%' : '—', '') +
      stat('', '输出成本占比', c.total ? fmtNum(c.outCost / c.total * 100, 1) + '%' : '');
  }

  function costRow(label, tokens, unitPrice, cost, cny) {
    return '<tr>' +
      '<td>' + escapeHtml(label) + '</td>' +
      '<td class="num">' + fmtInt(tokens) + '</td>' +
      '<td class="num">$' + fmtNum(unitPrice, 3) + '</td>' +
      '<td class="num">$' + fmtMoney(cost) + '</td>' +
      '<td class="num">¥' + fmtMoney(cost * cny) + '</td>' +
      '</tr>';
  }

  /* -------------------------------------------------- 上下文占用 */
  function renderContext(inputTokens) {
    const m = modelById(state.modelId);
    const total = inputTokens + Math.max(0, Number(state.outputTokens) || 0);
    const pct = m.ctx ? (total / m.ctx) * 100 : 0;
    const bar = $('#ctxMeter');
    bar.style.width = Math.min(100, pct) + '%';
    bar.parentElement.classList.toggle('warn', pct > 80);

    let verdict, cls;
    if (pct > 100) { verdict = '超出上下文窗口！'; cls = 'bad'; }
    else if (pct > 90) { verdict = '接近上限，建议压缩输入'; cls = 'warn'; }
    else if (pct > 70) { verdict = '占用较高'; cls = 'warn'; }
    else { verdict = '空间充足'; cls = 'ok'; }

    $('#ctxInfo').innerHTML =
      '<div class="row" style="align-items:center">' +
        '<div><span class="pill ' + cls + '">' + verdict + '</span></div>' +
        '<div class="dim">输入 + 输出 = <b>' + fmtInt(total) + '</b> / 上限 <b>' + fmtInt(m.ctx) +
        '</b> token（' + fmtNum(pct, 1) + '%）</div>' +
      '</div>' +
      (total > m.ctx
        ? '<div class="msg err" style="margin-top:8px">超出 ' + fmtInt(total - m.ctx) +
          ' token，需要裁剪输入或换用更大上下文的模型。</div>' : '');
  }

  /* ==================================================================
   * 四、模型选择与表单
   * ================================================================== */
  function renderModelSelect() {
    const sel = $('#modelSelect');
    const list = allModels();
    const groups = {};
    list.forEach(function (m) {
      (groups[m.vendor] = groups[m.vendor] || []).push(m);
    });
    const override = state.customPrices;
    sel.innerHTML = Object.keys(groups).map(function (v) {
      return '<optgroup label="' + escapeHtml(v) + '">' +
        groups[v].map(function (m) {
          const star = override[m.id] ? ' *' : '';
          return '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.label + star) + '</option>';
        }).join('') + '</optgroup>';
    }).join('');
    if (!list.some(function (m) { return m.id === state.modelId; })) {
      state.modelId = list[0].id;
    }
    sel.value = state.modelId;
    syncFormFromState();
  }

  /** 只更新下拉框里「已自定义」的星号，避免重建整个列表 */
  function syncModelOptionLabels() {
    $$('#modelSelect option').forEach(function (o) {
      const base = o.textContent.replace(/ \*$/, '');
      o.textContent = base + (state.customPrices[o.value] ? ' *' : '');
    });
  }

  function syncFormFromState() {
    const m = modelById(state.modelId);
    const p = priceOf(m);
    $('#priceIn').value = p.in;
    $('#priceOut').value = p.out;
    $('#priceCache').value = p.cacheIn;
    $('#modelCtx').value = m.ctx;
    $('#customBadge').classList.toggle('hidden', !state.customPrices[m.id]);
    // 只有提供空闲时段价格的模型才显示该开关
    const hasOff = !!m.offPeak;
    $('#offPeakWrap').classList.toggle('hidden', !hasOff);
    $('#offPeakWrap').style.display = hasOff ? 'flex' : 'none';
    $('#offPeak').checked = !!state.offPeak;
    $('#encSelect').value = state.encoding;
    $$('.chip[data-enc]').forEach(function (c) {
      c.classList.toggle('on', c.dataset.enc === state.encoding);
    });
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme === 'light' ? 'light' : 'dark');
    const b = $('#themeBtn');
    if (b) b.textContent = state.theme === 'light' ? '🌙 深色' : '☀️ 浅色';
  }

  /* ==================================================================
   * 五、事件绑定
   * ================================================================== */
  function bindUi() {
    $('#encSelect').addEventListener('change', function (e) {
      state.encoding = e.target.value;
      syncFormFromState();
      savePrefs();
      recompute();
    });

    $$('.chip[data-enc]').forEach(function (c) {
      c.addEventListener('click', function () {
        state.encoding = c.dataset.enc;
        $('#encSelect').value = state.encoding;
        syncFormFromState();
        savePrefs();
        recompute();
      });
    });

    $('#modelSelect').addEventListener('change', function (e) {
      state.modelId = e.target.value;
      syncFormFromState();
      savePrefs();
      recompute();
    });

    // 价格 / 上下文 / 成本参数
    let t2 = null;
    function softRecompute() {
      clearTimeout(t2);
      t2 = setTimeout(function () { renderModelTable((state.result || { ids: [] }).ids.length); renderCost((state.result || { ids: [] }).ids.length); renderContext((state.result || { ids: [] }).ids.length); }, 150);
    }

    ['#priceIn', '#priceOut', '#priceCache'].forEach(function (sel) {
      $(sel).addEventListener('input', function () {
        const m = modelById(state.modelId);
        state.customPrices[m.id] = {
          in: Number($('#priceIn').value),
          out: Number($('#priceOut').value),
          cacheIn: Number($('#priceCache').value)
        };
        $('#customBadge').classList.remove('hidden');
        savePrefs();
        syncModelOptionLabels();
        softRecompute();
      });
    });

    $('#modelCtx').addEventListener('input', function () {
      const m = modelById(state.modelId);
      m.ctx = Math.max(1, Number($('#modelCtx').value) || m.ctx);
      renderContext((state.result || { ids: [] }).ids.length);
      savePrefs();
    });

    // DeepSeek 空闲时段半价
    $('#offPeak').addEventListener('change', function (e) {
      state.offPeak = e.target.checked;
      savePrefs();
      softRecompute();
    });

    $('#resetPrice').addEventListener('click', function () {
      const m = modelById(state.modelId);
      delete state.customPrices[m.id];
      syncFormFromState();
      savePrefs();
      syncModelOptionLabels();
      softRecompute();
    });

    $('#outputTokens').addEventListener('input', function (e) {
      state.outputTokens = Math.max(0, Number(e.target.value) || 0);
      // 数字框可以填超过滑块上限的值，此时抬高滑块上限保持一致
      const range = $('#outputRange');
      if (state.outputTokens > Number(range.max)) range.max = state.outputTokens;
      range.value = state.outputTokens;
      savePrefs();
      softRecompute();
    });
    $('#outputRange').addEventListener('input', function (e) {
      state.outputTokens = Number(e.target.value);
      $('#outputTokens').value = state.outputTokens;
      savePrefs();
      softRecompute();
    });

    $('#cacheHit').addEventListener('input', function (e) {
      state.cacheHit = Number(e.target.value);
      $('#cacheHitVal').textContent = state.cacheHit + '%';
      savePrefs();
      softRecompute();
    });

    $('#calls').addEventListener('input', function (e) {
      state.calls = Math.max(1, Number(e.target.value) || 1);
      savePrefs();
      softRecompute();
    });

    $('#rate').addEventListener('input', function (e) {
      state.rate = Math.max(0.0001, Number(e.target.value) || 7.1);
      $('#rateVal').textContent = state.rate;
      savePrefs();
      softRecompute();
    });

    // 高亮开关
    $('#hlToggle').addEventListener('click', function () {
      state.showHighlight = !state.showHighlight;
      this.textContent = state.showHighlight ? '隐藏 token 颜色' : '显示 token 颜色';
      this.classList.toggle('primary', state.showHighlight);
      savePrefs();
      recompute();
    });

    // 主题
    $('#themeBtn').addEventListener('click', function () {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      applyTheme();
      savePrefs();
    });

    // 模型筛选
    $('#modelFilter').addEventListener('input', function (e) {
      state.filter = e.target.value;
      renderModelTable((state.result || { ids: [] }).ids.length);
    });

    // 预设文本
    $$('.chip[data-sample]').forEach(function (c) {
      c.addEventListener('click', function () {
        $('#editor').value = SAMPLES[c.dataset.sample] || '';
        state.text = $('#editor').value;
        recompute();
      });
    });

    // 清空 / 复制 / 导出
    $('#clearBtn').addEventListener('click', function () {
      $('#editor').value = '';
      state.text = '';
      recompute();
      $('#editor').focus();
    });

    $('#copyBtn').addEventListener('click', function () {
      const r = state.result;
      if (!r) return;
      const report = buildReport(r.ids.length);
      copyText(report, this);
    });

    $('#exportBtn').addEventListener('click', exportCsv);

    // 表格里「选用」
    $('#modelBody').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-use-model]');
      if (!btn) return;
      state.modelId = btn.dataset.useModel;
      $('#modelSelect').value = state.modelId;
      syncFormFromState();
      savePrefs();
      recompute();
      state.filter = '';
      $('#modelFilter').value = '';
      renderModelTable((state.result || { ids: [] }).ids.length);
      document.getElementById('costCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // 自定义模型
    $('#addModelBtn').addEventListener('click', function () {
      const label = $('#nmLabel').value.trim();
      if (!label) { alert('请填写模型名称'); return; }
      const m = {
        id: 'custom-' + Date.now().toString(36),
        label: label,
        vendor: $('#nmVendor').value.trim() || '自定义',
        encoding: $('#nmEncoding').value,
        ctx: Math.max(1, Number($('#nmCtx').value) || 128000),
        maxOut: 4096,
        price: {
          in: Number($('#nmIn').value) || 0,
          out: Number($('#nmOut').value) || 0,
          cacheIn: Number($('#nmCache').value) || Number($('#nmIn').value) || 0
        }
      };
      state.customModels.push(m);
      state.modelId = m.id;
      savePrefs();
      renderModelSelect();
      recompute();
      $('#nmLabel').value = '';
    });

    $('#resetAll').addEventListener('click', function () {
      if (!confirm('恢复默认设置？（会清除自定义模型、改过的价格与汇率）')) return;
      localStorage.removeItem(LS_KEY);
      location.reload();
    });

    // 拖放文本文件
    const ed = $('#editor');
    ed.addEventListener('dragover', function (e) { e.preventDefault(); });
    ed.addEventListener('drop', function (e) {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (f.size > 16 * 1024 * 1024) { alert('文件过大（上限 16 MB）'); return; }
      const fr = new FileReader();
      fr.onload = function () {
        const raw = String(fr.result);
        $('#editor').value = raw;   // 浏览器会把 \r\n 与 \r 统一成 \n
        state.text = $('#editor').value;
        // 输入框无法保留原始 CR，若文件含 CR 则单独说明真实差异
        if (raw.indexOf('\r') >= 0 && state.ready) {
          const enc = state.encoders[state.encoding];
          const rawTokens = enc.count(raw);
          state.rawInfo = {
            name: f.name,
            rawTokens: rawTokens,
            lfTokens: enc.count(state.text),
            rawCR: (raw.match(/\r/g) || []).length
          };
        } else {
          state.rawInfo = null;
        }
        recompute();
      };
      fr.readAsText(f);
    });
  }

  const SAMPLES = {
    zh: '人工智能正在深刻改变我们的工作方式。大语言模型可以理解、生成和转换自然语言，' +
        '并在编程、写作、翻译、数据分析等场景中提供帮助。\n\n' +
        '需要注意的是，模型的能力有其边界：它会犯错，也可能生成看似合理但并不准确的内容。',
    en: 'Large language models have transformed how we interact with software. ' +
        'They can summarize documents, answer questions, and write code.\n\n' +
        'However, they are not always right, and their outputs should be verified ' +
        'before being used in production.',
    code: 'def fibonacci(n: int) -> int:\n' +
          '    """Return the n-th Fibonacci number."""\n' +
          '    if n < 2:\n' +
          '        return n\n' +
          '    a, b = 0, 1\n' +
          '    for _ in range(n - 1):\n' +
          '        a, b = b, a + b\n' +
          '    return b\n\n' +
          'if __name__ == "__main__":\n' +
          '    print([fibonacci(i) for i in range(10)])\n',
    mixed: '这是一个中英混合的例子。Mixed language text is common in technical documents. ' +
           '例如 API 文档里会同时出现中文说明和英文术语，比如 token、embedding、context window。\n\n' +
           '价格：输入 $0.28 / 百万 token，输出 $0.42 / 百万 token。',
    emoji: 'Emoji 与特殊字符测试：😀 🎉 🚀 👍🏽 👨‍👩‍👧‍👦 🇨🇳\n' +
           '组合字符：e\u0301 a\u0300 o\u0308 n\u0303\n' +
           '符号：→ ← ↑ ↓ ★ ☆ ✓ ✗ ①②③ ⚠️\n' +
           '空白：Tab\t分隔，多个空格   与换行。'
  };

  /* -------------------------------------------------- 报告 / 导出 */
  function buildReport(inputTokens) {
    const m = modelById(state.modelId);
    const enc = state.encoders[state.encoding];
    const p = priceOf(m);
    const out = Math.max(0, Number(state.outputTokens) || 0);
    const hit = Math.max(0, Math.min(1, (Number(state.cacheHit) || 0) / 100));
    const c = calcCost(m, inputTokens, out, hit);
    const cny = p.currency === 'CNY' ? 1 : state.rate;
    const chars = Array.from(state.text || '').length;

    const lines = [];
    lines.push('Token 计算报告');
    lines.push('生成时间：' + new Date().toLocaleString('zh-CN'));
    lines.push('');
    lines.push('分词器：' + enc.name + '（精确匹配官方词表，非估算）');
    lines.push('字符数：' + fmtInt(chars));
    lines.push('Token 数：' + fmtInt(inputTokens));
    lines.push('平均字符/token：' + (inputTokens ? (chars / inputTokens).toFixed(2) : '—'));
    lines.push('');
    lines.push('模型：' + m.label + '（' + m.vendor + '）');
    lines.push('上下文窗口：' + fmtInt(m.ctx));
    lines.push('单价（每 100 万 token）：输入 $' + p.in + '，输出 $' + p.out +
               '，缓存命中 $' + p.cacheIn);
    lines.push('缓存命中率：' + state.cacheHit + '%');
    lines.push('输出 token：' + fmtInt(out));
    lines.push('');
    lines.push('单次成本：$' + fmtMoney(c.total) + '（≈ ¥' + fmtMoney(c.total * cny) + '）');
    lines.push('  其中输入 $' + fmtMoney(c.inCost) + '，输出 $' + fmtMoney(c.outCost));
    lines.push('× ' + fmtInt(state.calls) + ' 次：$' + fmtMoney(c.total * state.calls) +
               '（≈ ¥' + fmtMoney(c.total * state.calls * cny) + '）');
    lines.push('');
    lines.push('注：价格为人工整理，可能滞后于厂商调整，请以官网为准。');
    return lines.join('\n');
  }

  function copyText(text, btn) {
    const done = function () {
      const old = btn.textContent;
      btn.textContent = '✓ 已复制';
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else fallback();

    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { alert('复制失败，请手动选择文本'); }
      document.body.removeChild(ta);
    }
  }

  function exportCsv() {
    const inputTokens = (state.result || { ids: [] }).ids.length;
    const rows = [['模型', '厂商', '分词器', '上下文', '输入token', '输入价($/1M)',
                   '输出价($/1M)', '输出token', '单次成本($)']];
    allModels().forEach(function (m) {
      if (!state.encoders[m.encoding]) return;
      const n = m.encoding === state.encoding ? inputTokens
        : tokenCountFor(m.encoding, state.text || '');
      const p = priceOf(m);
      const out = Math.max(0, Number(state.outputTokens) || 0);
      const cost = (n / 1e6) * p.in + (out / 1e6) * p.out;
      rows.push([m.label, m.vendor, m.encoding, m.ctx, n, p.in, p.out, out, cost.toFixed(6)]);    });
    const csv = '\uFEFF' + rows.map(function (r) {
      return r.map(function (v) {
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-cost-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* ================================================================== */
  document.addEventListener('DOMContentLoaded', function () {
    bindUi();
    boot();
  });
})();
