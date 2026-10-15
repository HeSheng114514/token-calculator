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
 * 模型目录：把「分词器」与「模型 / 价格 / 上下文」对应起来。
 *
 * ============ 关于价格（先看这里）============
 *   - price 里的数字是「每 100 万 token 的美元价」（用 0.28 表示 $0.28/1M）。
 *   - 数据整理时间：2026-10。来源以各厂商官方定价页为主，
 *     并用 LiteLLM 的公开价目表（litellm/model_prices_and_context_window.json）交叉核对。
 *   - 厂商随时会调价、改名、下线模型。本页所有价格都可以直接手动修改，
 *     也可以自行添加模型；请以厂商官网为准。
 *   - currency: 'USD' 表示原价即美元；'CNY' 表示厂商以人民币计价
 *     （页面按可配置汇率换算展示，不会把两种货币静默混在一起）。
 *
 * 已核对到 2026-10 的关键变化（避免用过期信息）：
 *   - deepseek-chat / deepseek-reasoner 这两个别名已于 2026-07 停止使用，
 *     当前是 deepseek-flash（DeepSeek-V4.1-Flash）与 deepseek-v4-pro。
 *   - qwen-turbo、doubao-1.5-pro、kimi-k2 等已不在当前价目表中。
 *   - 上下文窗口普遍涨到 1M；DeepSeek 有「空闲时段半价」。
 */

const ENCODINGS = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    note: 'DeepSeek-V3 / V3.2 / V4 系列，12.8 万词表',
    vendor: 'DeepSeek',
    sample: '你好，世界！Hello, world! 12345'
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen / 通义千问',
    note: 'Qwen2.5 / Qwen3，15.1 万词表',
    vendor: '阿里云',
    sample: '你好，世界！Hello, world! 12345'
  },
  qwen38: {
    id: 'qwen38',
    label: 'Qwen3.8',
    note: 'Qwen3.8 系列，24.8 万词表（比 2.5 略省 token）',
    vendor: '阿里云',
    sample: '你好，世界！Hello, world! 12345'
  },
  glm: {
    id: 'glm',
    label: 'GLM / 智谱',
    note: 'GLM-4.6 / GLM-5 系列，15.5 万词表',
    vendor: '智谱 AI',
    sample: '你好，世界！Hello, world! 12345'
  },
  o200k: {
    id: 'o200k',
    label: 'OpenAI o200k',
    note: 'GPT-4o 及更新系列，20 万词表',
    vendor: 'OpenAI',
    sample: '你好，世界！Hello, world! 12345'
  },
  cl100k: {
    id: 'cl100k',
    label: 'OpenAI cl100k',
    note: 'GPT-4 / GPT-3.5 / text-embedding-3，10 万词表',
    vendor: 'OpenAI',
    sample: '你好，世界！Hello, world! 12345'
  }
};

/**
 * 每个模型：{ id, label, vendor, encoding, ctx, maxOut?, price:{in,out,cacheIn?}, currency? , offPeak? }
 * ctx / maxOut 单位：token；price 单位：USD / 1M token
 * offPeak: {in,out,cacheIn} 表示空闲时段价格（DeepSeek）
 * cny: 以人民币计价时的原价（仅作展示，不参与换算）
 */
const MODELS = [
  // ---------------- DeepSeek（官方价目表 2026-10）----------------
  { id: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)', vendor: 'DeepSeek', encoding: 'deepseek',
    ctx: 1000000, maxOut: 384000, price: { in: 0.3, out: 1.2, cacheIn: 0.006 },
    offPeak: { in: 0.15, out: 0.6, cacheIn: 0.003 }, cny: { in: 2, out: 8, cacheIn: 0.04 } },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', vendor: 'DeepSeek', encoding: 'deepseek',
    ctx: 1000000, maxOut: 384000, price: { in: 1.32, out: 3.96, cacheIn: 0.044 },
    offPeak: { in: 0.66, out: 1.98, cacheIn: 0.022 }, cny: { in: 9, out: 27, cacheIn: 0.3 } },
  { id: 'deepseek-v3.2', label: 'DeepSeek V3.2（旧版仍可用）', vendor: 'DeepSeek', encoding: 'deepseek',
    ctx: 131072, maxOut: 65536, price: { in: 0.28, out: 0.42, cacheIn: 0.028 } },

  // ---------------- OpenAI（o200k 词表）----------------
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 1050000, maxOut: 128000, price: { in: 5, out: 30, cacheIn: 0.5 } },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 1050000, maxOut: 128000, price: { in: 2, out: 12, cacheIn: 0.2 } },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 1050000, maxOut: 128000, price: { in: 0.2, out: 1.2, cacheIn: 0.02 } },
  { id: 'gpt-5.4', label: 'GPT-5.4', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 1050000, maxOut: 128000, price: { in: 2.5, out: 15, cacheIn: 0.25 } },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 400000, maxOut: 128000, price: { in: 0.75, out: 4.5, cacheIn: 0.075 } },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 400000, maxOut: 128000, price: { in: 0.2, out: 1.25, cacheIn: 0.02 } },
  { id: 'gpt-5.2', label: 'GPT-5.2', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 400000, maxOut: 128000, price: { in: 1.75, out: 14, cacheIn: 0.175 } },
  { id: 'gpt-5.1', label: 'GPT-5.1', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 400000, maxOut: 128000, price: { in: 1.25, out: 10, cacheIn: 0.125 } },
  { id: 'gpt-5', label: 'GPT-5', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 400000, maxOut: 128000, price: { in: 1.25, out: 10, cacheIn: 0.125 } },
  { id: 'gpt-5-mini', label: 'GPT-5 mini', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 400000, maxOut: 128000, price: { in: 0.25, out: 2, cacheIn: 0.025 } },
  { id: 'gpt-5-nano', label: 'GPT-5 nano', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 400000, maxOut: 128000, price: { in: 0.05, out: 0.4, cacheIn: 0.005 } },
  { id: 'gpt-4.1', label: 'GPT-4.1', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 1047576, maxOut: 32768, price: { in: 2, out: 8, cacheIn: 0.5 } },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 1047576, maxOut: 32768, price: { in: 0.4, out: 1.6, cacheIn: 0.1 } },
  { id: 'gpt-4o', label: 'GPT-4o', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 128000, maxOut: 16384, price: { in: 2.5, out: 10, cacheIn: 1.25 } },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 128000, maxOut: 16384, price: { in: 0.15, out: 0.6, cacheIn: 0.075 } },
  { id: 'o3', label: 'o3', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 200000, maxOut: 100000, price: { in: 2, out: 8, cacheIn: 0.5 } },
  { id: 'o4-mini', label: 'o4-mini', vendor: 'OpenAI', encoding: 'o200k',
    ctx: 200000, maxOut: 100000, price: { in: 1.1, out: 4.4, cacheIn: 0.275 } },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', vendor: 'OpenAI', encoding: 'cl100k',
    ctx: 16385, maxOut: 4096, price: { in: 0.5, out: 1.5 } },

  // ---------------- Anthropic（无公开开源词表，用 cl100k 近似，仅作估算）----------------
  { id: 'claude-opus-5.5', label: 'Claude Opus 5.5', vendor: 'Anthropic', encoding: 'cl100k',
    approx: true, ctx: 1000000, maxOut: 64000, price: { in: 4, out: 20, cacheIn: 0.4 } },
  { id: 'claude-opus-5', label: 'Claude Opus 5', vendor: 'Anthropic', encoding: 'cl100k',
    approx: true, ctx: 1000000, maxOut: 64000, price: { in: 5, out: 25, cacheIn: 0.5 } },
  { id: 'claude-sonnet-5.5', label: 'Claude Sonnet 5.5', vendor: 'Anthropic', encoding: 'cl100k',
    approx: true, ctx: 1000000, maxOut: 64000, price: { in: 2, out: 10, cacheIn: 0.2 } },
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', vendor: 'Anthropic', encoding: 'cl100k',
    approx: true, ctx: 1000000, maxOut: 64000, price: { in: 3, out: 15, cacheIn: 0.3 } },
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', vendor: 'Anthropic', encoding: 'cl100k',
    approx: true, ctx: 200000, maxOut: 64000, price: { in: 1, out: 5, cacheIn: 0.1 } },
  { id: 'claude-opus-4.5', label: 'Claude Opus 4.5', vendor: 'Anthropic', encoding: 'cl100k',
    approx: true, ctx: 200000, maxOut: 64000, price: { in: 5, out: 25, cacheIn: 0.5 } },

  // ---------------- Google（用 o200k 近似，仅作估算）----------------
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', vendor: 'Google', encoding: 'o200k',
    approx: true, ctx: 1000000, maxOut: 65536, price: { in: 2, out: 12 } },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', vendor: 'Google', encoding: 'o200k',
    approx: true, ctx: 1000000, maxOut: 65536, price: { in: 1.5, out: 9, cacheIn: 0.15 } },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', vendor: 'Google', encoding: 'o200k',
    approx: true, ctx: 1000000, maxOut: 65536, price: { in: 0.3, out: 2.5 } },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', vendor: 'Google', encoding: 'o200k',
    approx: true, ctx: 1048576, maxOut: 65536, price: { in: 1.25, out: 10 } },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', vendor: 'Google', encoding: 'o200k',
    approx: true, ctx: 1048576, maxOut: 65535, price: { in: 0.3, out: 2.5 } },

  // ---------------- 阿里云 通义千问（官方价目表，USD）----------------
  { id: 'qwen3.8-max', label: '通义千问 qwen3.8-max', vendor: '阿里云', encoding: 'qwen38',
    ctx: 1000000, maxOut: 131072, price: { in: 2, out: 6 }, cny: { in: 12, out: 36 } },
  { id: 'qwen3.8-flash', label: '通义千问 qwen3.8-flash', vendor: '阿里云', encoding: 'qwen38',
    ctx: 1000000, maxOut: 131072, price: { in: 0.15, out: 0.47 }, cny: { in: 0.8, out: 2.7 } },
  { id: 'qwen3.7-plus', label: '通义千问 qwen3.7-plus', vendor: '阿里云', encoding: 'qwen38',
    ctx: 1000000, maxOut: 131072, price: { in: 0.4, out: 1.6 }, cny: { in: 2, out: 8 } },
  { id: 'qwen3-max', label: '通义千问 qwen3-max', vendor: '阿里云', encoding: 'qwen',
    ctx: 262144, maxOut: 32768, price: { in: 1.2, out: 6 } },
  { id: 'qwen-max', label: '通义千问 qwen-max（旧）', vendor: '阿里云', encoding: 'qwen',
    ctx: 32768, maxOut: 8192, price: { in: 1.6, out: 6.4, cacheIn: 0.48 } },
  { id: 'qwen-plus', label: '通义千问 qwen-plus', vendor: '阿里云', encoding: 'qwen',
    ctx: 129024, maxOut: 16384, price: { in: 0.4, out: 1.2 } },

  // ---------------- 月之暗面 Kimi（未公开开源词表，用 DeepSeek 词表近似）----------------
  { id: 'kimi-k3', label: 'Kimi K3', vendor: '月之暗面', encoding: 'deepseek',
    approx: true, ctx: 1048576, maxOut: 65536, price: { in: 3, out: 15, cacheIn: 0.3 } },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', vendor: '月之暗面', encoding: 'deepseek',
    approx: true, ctx: 262144, maxOut: 32768, price: { in: 0.95, out: 4, cacheIn: 0.19 } },
  { id: 'kimi-k2.6', label: 'Kimi K2.6', vendor: '月之暗面', encoding: 'deepseek',
    approx: true, ctx: 262144, maxOut: 32768, price: { in: 0.95, out: 4, cacheIn: 0.16 } },

  // ---------------- 智谱 GLM ----------------
  { id: 'glm-5.3', label: 'GLM-5.3', vendor: '智谱 AI', encoding: 'glm',
    ctx: 1000000, maxOut: 128000, price: { in: 1.4, out: 4.4, cacheIn: 0.26 } },
  { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash', vendor: '智谱 AI', encoding: 'glm',
    ctx: 1000000, maxOut: 128000, price: { in: 0.15, out: 0.5, cacheIn: 0.03 } },
  { id: 'glm-5', label: 'GLM-5', vendor: '智谱 AI', encoding: 'glm',
    ctx: 1000000, maxOut: 128000, price: { in: 1, out: 3.2, cacheIn: 0.2 } },
  { id: 'glm-4.6', label: 'GLM-4.6', vendor: '智谱 AI', encoding: 'glm',
    approx: true, ctx: 204800, maxOut: 131072, price: { in: 0.6, out: 2.2, cacheIn: 0.11 } },
  { id: 'glm-4.5-air', label: 'GLM-4.5-Air', vendor: '智谱 AI', encoding: 'glm',
    approx: true, ctx: 131072, maxOut: 98304, price: { in: 0.2, out: 1.1, cacheIn: 0.03 } },

  // ---------------- 字节豆包（官方以人民币计价，价格即 CNY）----------------
  { id: 'doubao-seed-2.1-pro', label: '豆包 Doubao-Seed-2.1-pro', vendor: '字节跳动', encoding: 'cl100k',
    approx: true, ctx: 1024000, maxOut: 262144,
    price: { in: 6, out: 30, cacheIn: 1.2, currency: 'CNY' } },
  { id: 'doubao-seed-2.1-turbo', label: '豆包 Doubao-Seed-2.1-turbo', vendor: '字节跳动', encoding: 'cl100k',
    approx: true, ctx: 256000, maxOut: 262144,
    price: { in: 3, out: 15, cacheIn: 0.6, currency: 'CNY' } },
  { id: 'doubao-seed-2.0-lite', label: '豆包 Doubao-Seed-2.0-lite', vendor: '字节跳动', encoding: 'cl100k',
    approx: true, ctx: 256000, maxOut: 32768,
    price: { in: 0.6, out: 3.6, cacheIn: 0.12, currency: 'CNY' } },

  // ---------------- 通用估算档 ----------------
  { id: 'generic-gpt', label: '通用估算（GPT 风格）', vendor: '自定义', encoding: 'o200k',
    ctx: 128000, maxOut: 4096, price: { in: 1, out: 3 } },
  { id: 'generic-cn', label: '通用估算（国产模型）', vendor: '自定义', encoding: 'deepseek',
    ctx: 128000, maxOut: 4096, price: { in: 0.5, out: 1.5 } }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ENCODINGS: ENCODINGS, MODELS: MODELS };
}
