# LLM API Pricing & Context Windows — as of 2026-10-15

All USD prices are per **1M tokens**. CNY prices are shown **as published in CNY** (no conversion applied).
Confidence reflects whether I reached an **official vendor pricing page** for that row.

Legend: **Ctx** = context window; **MaxOut** = max output tokens; **Cache** = cache-hit / cached-input price.

## 1. DeepSeek — official (api-docs.deepseek.com)

Off-peak = **50% of peak**, still offered. Peak hours: 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri,
excluding Chinese public holidays; all other hours (incl. weekends/CN holidays) are off-peak.
Source: <https://api-docs.deepseek.com/quick_start/pricing>

| Model | Ctx | MaxOut | In (peak / off-peak) | Cache hit (peak / off-peak) | Out (peak / off-peak) | Conf |
|---|---|---|---|---|---|---|
| `deepseek-flash` (DeepSeek-V4.1-Flash) | 1M | 384K | $0.30 / $0.15 | $0.006 / $0.003 | $1.20 / $0.60 | high |
| `deepseek-v4-pro` (V4-Pro-0813) | 1M | 384K | $1.32 / $0.66 | $0.044 / $0.022 | $3.96 / $1.98 | high |

CNY (official zh-cn page):

| Model | In peak/off-peak | Cache hit peak/off-peak | Out peak/off-peak |
|---|---|---|---|
| `deepseek-flash` | ¥2 / ¥1 | ¥0.04 / ¥0.02 | ¥8 / ¥4 |
| `deepseek-v4-pro` | ¥9.0 / ¥4.5 | ¥0.30 / ¥0.15 | ¥27.0 / ¥13.5 |

⚠️ **`deepseek-chat` and `deepseek-reasoner` are RETIRED.** Per the official changelog, the legacy
alias names were discontinued on **2026-07-24** (they had pointed at V4-Flash non-thinking / thinking).
Current names are `deepseek-flash` and `deepseek-v4-pro`.
Source: <https://api-docs.deepseek.com/updates>

## 2. OpenAI

⚠️ **openai.com and platform.openai.com are network-blocked from this environment** — I could not open
the official API pricing page directly. Prices below combine OpenAI's own Help Center rate card
(article 20001415, an official OpenAI source), Microsoft Learn (official Azure OpenAI model specs, for
context windows) and the OpenRouter model registry (mirror). Treat as **medium** confidence unless noted.

| Model | Ctx | MaxOut | In | Cached in | Out | Conf |
|---|---|---|---|---|---|---|
| gpt-6-astra | 1.05M | 128K | $10.00 | $1.00 | $50.00 | medium |
| gpt-6.1-sol | 1.05M | 128K | $2.00 | $0.10 | $10.00 | medium |
| gpt-6-sol | 1.05M | 128K | $2.00 | $0.20 | $10.00 | medium |
| gpt-6-luna | 1.05M | 128K | $0.10 | $0.01 | $0.50 | medium |
| gpt-5.6-sol | 1.05M (922K API in) | 128K | $5.00 ($4.00 promo¹) | $0.50 | $30.00 ($20.00 promo¹) | medium |
| gpt-5.6-terra | 1.05M (922K API in) | 128K | $2.00 | $0.20 | $12.00 | medium |
| gpt-5.6-luna | 1.05M (922K API in) | 128K | $0.20 | $0.02 | $1.20 | medium |
| gpt-5.5 | 1.05M (922K API in) | 128K | $5.00 | $0.50 | $30.00 | medium |
| gpt-5.4 | 1.05M | 128K | $2.50 | $0.25 | $15.00 | medium |
| gpt-5.4-mini | 400K | 128K | $0.75 | $0.075 | $4.50 | medium |
| gpt-5.4-nano | 400K | 128K | $0.20 | $0.02 | $1.25 | medium |
| gpt-5.3-codex | 400K | 128K | $1.75 | $0.175 | $14.00 | medium |
| gpt-5.2 | 400K | 128K | $1.75 | $0.175 | $14.00 | medium |
| gpt-5.2-pro | 400K | 128K | $21.00 | – | $168.00 | medium |
| gpt-5.1 | 400K | 128K | $1.25 | $0.125 | $10.00 | medium |
| **gpt-5** | 400K | 128K | $1.25 | $0.125 | $10.00 | high² |
| gpt-5-mini | 400K | 128K | $0.25 | $0.025 | $2.00 | high² |
| gpt-5-nano | 400K | 128K | $0.05 | $0.005 | $0.40 | high² |
| **gpt-4.1** | 1,047,576 | 32,768 | $2.00 | $0.50 | $8.00 | high² |
| **gpt-4.1-mini** | 1,047,576 | 32,768 | $0.40 | $0.10 | $1.60 | high² |
| gpt-4.1-nano | 1,047,576 | 32,768 | $0.10 | $0.025 | $0.40 | high² |
| **gpt-4o** | 128K | 16,384 | $2.50 | $1.25 | $10.00 | high² |
| **gpt-4o-mini** | 128K | 16,384 | $0.15 | $0.075 | $0.60 | high² |
| **o3** | 200K | 100K | $2.00 | $0.50 | $8.00 | high² |
| **o4-mini** | 200K | 100K | $1.10 | $0.275 | $4.40 | high² |

¹ OpenAI's rate card states the GPT-5.6 Sol promotional price runs at least through 2026-11-21.
² "high" here = each of these legacy prices is independently confirmed by two sources (OpenRouter registry
+ Microsoft Learn spec pages for context windows); note this is not the primary openai.com pricing page.

Other OpenAI pricing mechanics (standard, high confidence from repeated industry reporting):
- **Batch API = 50% off** input and output; cached input typically 10% of input price (90% discount).
- GPT-5.6 long-context: prompts **>272K input tokens** bill at 2× input and 1.5× output for the whole
  request → Sol $10/$45, Terra $4/$18, Luna $0.40/$1.80.
- Flex processing ≈ 50% for GPT-5.6 rows (Sol $2.50/$15, Terra $1/$6, Luna $0.10/$0.60).

## 3. Anthropic — official rate card

Source: official **Anthropic List Prices PDF, effective 2026-10-07**
(<https://assets.claude.com/1ef7a4a8e373004bc89d710b0a6f3f219323344f.pdf>).
Prices are USD/MTok. "US-only inference" is **10% higher** than Global. Batch = 50%.

| Model | Ctx | In (Global) | 5m cache write | 1h cache write | Cache hit | Out | Conf |
|---|---|---|---|---|---|---|---|
| Claude Opus 5.5 | n/s³ | $4.00 | $5.00 | $8.00 | $0.20 | $20.00 | high |
| Claude Sonnet 5.5 | n/s³ | $2.00 | $2.50 | $4.00 | $0.10 | $10.00 | high |
| Claude Haiku 5.5 (≤100K) | 100K | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 | high |
| Claude Haiku 5.5 (>100K) | >100K | $0.50 | $0.625 | $1.00 | $0.05 | $2.50 | high |
| Claude Mythos 5.1 (limited) | n/s³ | $10.00 | $12.50 | $20.00 | $0.25 | $50.00 | high |
| Claude Fable 5.1 | n/s³ | $10.00 | $12.50 | $20.00 | $0.25 | $50.00 | high |
| Claude Opus 5 | n/s³ | $5.00 | $6.25 | $10.00 | $0.50 | $25.00 | high |
| Claude Sonnet 5 | n/s³ | $2.00 | $2.50 | $4.00 | $0.20 | $10.00 | high |
| Claude Fable 5 | n/s³ | $10.00 | $12.50 | $20.00 | $1.00 | $50.00 | high |
| **Claude Opus 4.8** | 1M⁴ | $5.00 | $6.25 | $10.00 | $0.50 | $25.00 | high |
| Claude Opus 4.7 | 1M⁴ | $5.00 | $6.25 | $10.00 | $0.50 | $25.00 | high |
| **Claude Opus 4.6** | 1M⁴ | $5.00 | $6.25 | $10.00 | $0.50 | $25.00 | high |
| Claude Opus 4.5 | **200K** | $5.00 | $6.25 | $10.00 | $0.50 | $25.00 | high |
| **Claude Sonnet 4.6** | 1M⁴ | $3.00 | $3.75 | $6.00 | $0.30 | $15.00 | high |
| **Claude Haiku 4.5** | **200K** | $1.00 | $1.25 | $2.00 | $0.10 | $5.00 | high |

³ The rate card lists context window as "All" for these SKUs — the exact window is not stated on the
official price PDF, so I am not asserting a number.
⁴ 1M context is from the OpenRouter registry / Anthropic marketing, **not** from the rate-card PDF
(the PDF does not print window sizes for these rows) — **medium** confidence on the window, high on price.

Caching: Anthropic's cache-hit price is 10% of base input; 5-min cache write = 1.25× base input,
1-hour cache write = 2× base input. Batch processing = 50% off.

## 4. Google Gemini

⚠️ **ai.google.dev / cloud.google.com are network-blocked from this environment** — the official
Gemini API pricing page could not be opened directly. Prices below are **medium** confidence, drawn from
Google Cloud's Gemini Enterprise Agent Platform pricing page and multiple consistent secondary sources.
Context/output figures for Gemini 3.x are confirmed by official Google DeepMind model pages (1M input / 64K output).

| Model | Ctx | MaxOut | In | Cached in | Out | Conf |
|---|---|---|---|---|---|---|
| Gemini 3.1 Pro | 1M | 64K | $2.00 (≤200K) / $4.00 (>200K) | n/v⁵ | $12.00 | medium |
| Gemini 3.8 Flash | 1M | 64K | $0.75 (intro⁶) | n/v⁵ | $3.75 (intro⁶) | medium |
| Gemini 3.7 Flash | 1M | 64K | $0.75 (intro⁶) | n/v⁵ | $3.75 (intro⁶) | medium |
| Gemini 3.6 Flash | 1M | 64K | $0.75 (intro⁶) | n/v⁵ | $3.75 (intro⁶) | medium |
| Gemini 3.5 Flash | 1M | 64K | $1.50 | $0.15 | $9.00 | medium |
| Gemini 3.5 Flash-Lite | 1M | 64K | $0.30 | n/v⁵ | $2.50 | medium |
| Gemini 3.1 Flash-Lite | 1M | 65.5K | $0.25 | n/v⁵ | $1.50 | medium |
| **Gemini 2.5 Pro** | 1,048,576 | 65,536 | $1.25 | n/v⁵ | $10.00 | high⁷ |
| **Gemini 2.5 Flash** | 1,048,576 | 65,535 | $0.30 | n/v⁵ | $2.50 | high⁷ |
| **Gemini 2.5 Flash-Lite** | 1,048,576 | 65,535 | $0.10 | n/v⁵ | $0.40 | high⁷ |

⁵ Cached-input ("context caching") exists for Gemini and is a real discount, but I could not read exact
per-model cached rates from an official page — **explicitly unverified**, do not quote a number.
⁶ Introductory pricing through **2026-12-31**; standard pricing from 2027-01-01 is $1.50/$7.50.
⁷ 2.5-series prices/context confirmed via OpenRouter registry (mirrors Google list pricing); medium-high.

Batch API = 50% cost reduction (Google-documented, high confidence).

## 5. Alibaba Qwen / DashScope — official

Sources: <https://www.alibabacloud.com/help/en/model-studio/model-pricing> (International, USD) and
<https://help.aliyun.com/zh/model-studio/model-pricing> (China, CNY). Context/output limits from
official per-model pages. **CNY is published separately — shown as-is.**

International / USD:

| Model | Ctx | MaxOut | In | Out | Conf |
|---|---|---|---|---|---|
| qwen3.8-max | 1M | 131,072 | $2.00 | $6.00 | high |
| qwen3.8-max-prime (fast mode) | 1M | 131,072 | $3.301 | $9.902 | high |
| qwen3.7-max | 1M | 131,072 | $2.50 | $7.50 | high |
| qwen3.7-plus (≤256K) | 1M | 131,072 | $0.40 | $1.60 | high |
| qwen3.7-plus (256K–1M) | 1M | 131,072 | $1.20 | $4.80 | high |
| qwen3.8-flash | 1M | 131,072 | $0.15 | $0.47 | high |
| qwen3.7-flash (≤32K / ≤256K / ≤1M) | 1M | 65,536 | $0.030 / $0.100 / $0.200 | $0.130 / $0.400 / $0.800 | high |
| qwen-max (legacy) | 32,768 | 8,192 | $1.60 | $6.40 | high |
| qwen-plus (legacy, ≤256K) | 1M | – | $0.40 | $1.20 (non-think) / $4.00 (thinking) | high |
| qwen-flash (legacy, ≤256K) | 1M | – | $0.05 | $0.40 | high |

China / CNY (Beijing region):

| Model | In | Out | Cache hit |
|---|---|---|---|
| qwen3.8-max | ¥12 | ¥36 | see cache rules |
| qwen3.8-max-prime | ¥24 | ¥72 | – |
| qwen3.7-plus (≤256K) | ¥2 | ¥8 | – |
| qwen3.7-plus (256K–1M) | ¥6 | ¥24 | – |
| qwen3.8-flash | ¥0.8 | ¥2.7 | – |
| qwen-max (legacy) | ¥2.4 | ¥9.6 | ¥0.48 |
| qwen-plus (legacy, ≤128K) | ¥0.8 | ¥2 (non-think) / ¥8 (thinking) | – |
| qwen-plus (legacy, 128–256K) | ¥2.4 | ¥20 / ¥24 | – |
| qwen-plus (legacy, 256K–1M) | ¥4.8 | ¥48 / ¥64 | – |

Cache rules (official): **explicit cache creation = 125% of standard input; explicit cache hits = 10%;
implicit cache hits = 20%.** Batch inference = 50% off. These two discounts cannot be combined.
Source: <https://www.alibabacloud.com/help/en/model-studio/context-cache>

⚠️ **`qwen-turbo` is NOT present on the current official DashScope/Model Studio pricing pages** (neither
the International USD nor the China CNY page). It appears retired/discontinued. **Unverified — do not quote.**

## 6. Moonshot Kimi — official

Source: <https://platform.kimi.ai/docs/pricing/chat> (USD, per 1M tokens).

| Model | Ctx | In (cache miss) | Cache hit | Cache write 5m / 1h | Out | Conf |
|---|---|---|---|---|---|---|
| **kimi-k3** | 1,048,576 | $3.00 | $0.30 | $3.00 / $6.00 | $15.00 | high |
| kimi-k2.7-code | 262,144 | $0.95 | $0.19 | – | $4.00 | high |
| kimi-k2.7-code-highspeed | 262,144 | $1.90 | $0.38 | – | $8.00 | high |
| kimi-k2.6 | 262,144 | $0.95 | $0.16 | – | $4.00 | high |

⚠️ **`kimi-k2`, `kimi-latest` and the `moonshot-v1` series are DISCONTINUED** (kimi-k2 on 2026-05-25;
kimi-latest on 2026-01-28; moonshot-v1 and kimi-k2.5 on 2026-08-31). Source:
<https://platform.kimi.ai/docs/models.md>

## 7. Zhipu GLM (Z.AI) — official

Source: <https://docs.z.ai/guides/overview/pricing> (USD, per 1M tokens). Cache storage free (limited time).

| Model | Ctx | MaxOut | In | Cached in | Out | Conf |
|---|---|---|---|---|---|---|
| GLM-5.3 | 1M | 128K | $1.40 | $0.26 | $4.40 | high |
| GLM-5.3-Flash | 1M | 131K | $0.15 | $0.03 | $0.50 | high |
| GLM-5.3-FlashX | 1M | 131K | $0.37 | $0.075 | $1.25 | high |
| GLM-5.2 | 1M | 128K | $1.40 | $0.26 | $4.40 | high |
| GLM-5.1 | 204.8K | 128K | $1.40 | $0.26 | $4.40 | high |
| GLM-5 | 204.8K | 131K | $1.00 | $0.20 | $3.20 | high |
| GLM-4.7 | 204.8K | 131K | $0.60 | $0.11 | $2.20 | high |
| **GLM-4.6** | 204.8K | 131K | $0.60 | $0.11 | $2.20 | high |
| GLM-4.5 | 131K | 98K | $0.60 | $0.11 | $2.20 | high |
| GLM-4.5-Air | 131K | 98K | $0.20 | $0.03 | $1.10 | high |
| GLM-4.5-X | 131K | 98K | $2.20 | $0.45 | $8.90 | high |

CNY (Zhipu BigModel, from Chinese tech media — **not** read from an official page, **medium/low**):
GLM-5.3-Flash ¥0.8 in / ¥2.8 out / ¥0.23 cache hit (limited-time 50% off); GLM-5.3-FlashX ¥2 in / ¥7 out.

## 8. ByteDance Doubao (Volcengine Ark) — official, **CNY**

Source: <https://www.volcengine.com/docs/82379/1099320> (模型价格). All figures **元 (CNY) per 1M tokens**.
Cache storage is ¥0.017/1M tokens/hour across the board.

| Model | Ctx | MaxOut | In (non-audio) | Cache hit | Out | Conf |
|---|---|---|---|---|---|---|
| doubao-seed-evolving | 1024K | 256K | ¥6.00 | ¥1.20 | ¥30.00 | high |
| doubao-seed-2.1-pro | ~1024K | 256K | ¥6.00 | ¥1.20 | ¥30.00 | high |
| doubao-seed-2.1-lite | ~1024K | – | ¥0.80 (audio ¥12.00) | ¥0.16 (audio ¥2.40) | ¥2.70 | high |
| doubao-seed-2.1-turbo | ≤256K | – | ¥3.00 | ¥0.60 | ¥15.00 | high |
| doubao-seed-2.0-pro (≤32K) | 256K | – | ¥3.2 | ¥0.64 | ¥16.0 | high |
| doubao-seed-2.0-pro (32–128K) | 256K | – | ¥4.8 | ¥0.96 | ¥24.0 | high |
| doubao-seed-2.0-pro (128–256K) | 256K | – | ¥9.6 | ¥1.92 | ¥48.0 | high |
| doubao-seed-2.0-lite (≤32K) | 256K | – | ¥0.6 | ¥0.12 | ¥3.6 | high |
| doubao-seed-2.0-mini (≤32K) | 256K | – | ¥0.2 | ¥0.04 | ¥2.0 | high |
| doubao-seed-2.0-code (≤32K) | 256K | – | ¥3.2 | ¥0.64 | ¥16.0 | high |

⚠️ **`doubao-1.5-pro` is NOT present in the current Volcengine price table** — appears superseded by the
Seed 2.x line. **Unverified — do not quote a price for it.**

## 9. Meta Llama 4 (hosted reference pricing) — no official first-party API

Meta publishes no first-party hosted API, so "official" pricing does not exist. Major providers:

| Model | Ctx | In | Out | Provider | Conf |
|---|---|---|---|---|---|
| Llama 4 Maverick | 1,048,576 | $0.27 | $0.85 | Novita (via OpenRouter) | medium |
| Llama 4 Maverick | 524,288 | $0.35 | $1.15 | Google (via OpenRouter) | medium |
| Llama 4 Scout | 327,680 | $0.10 | $0.30 | DeepInfra (via OpenRouter) | medium |
| Llama 4 Scout | 1,310,720 | $0.25 | $0.70 | Google (via OpenRouter) | medium |

⚠️ Together AI's current **serverless inference** table no longer lists Llama 4 Maverick/Scout; the
"Llama 4 Maverick $5.60 / $14.00 / $16.00" figures on their page are **fine-tuning (SFT/DPO/min-charge)**
prices, **not** inference pricing — do not confuse them.
Official Meta context windows (from Meta's April 2025 launch, high confidence): Scout **10M**, Maverick **1M**.

## Sources

Official / primary:
- DeepSeek Models & Pricing — https://api-docs.deepseek.com/quick_start/pricing
- DeepSeek Change Log (V4 / alias retirement) — https://api-docs.deepseek.com/updates
- Anthropic List Prices (PDF, effective 2026-10-07) — https://assets.claude.com/1ef7a4a8e373004bc89d710b0a6f3f219323344f.pdf
- Anthropic pricing docs (blocked from this env) — https://platform.claude.com/docs/en/about-claude/pricing
- Microsoft Learn, Azure OpenAI model specs (context windows) — https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models
- Azure OpenAI pricing — https://azure.microsoft.com/en-us/pricing/details/azure-openai/
- OpenAI Help Center rate card — https://help.openai.com/articles/20001415 (blocked here; read via search index)
- Google DeepMind Gemini model pages — https://deepmind.google/models/gemini/pro/ , /flash/ , /flash-lite/
- Google Cloud Gemini Enterprise Agent Platform pricing — https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
- Gemini Developer API pricing (blocked here) — https://ai.google.dev/gemini-api/docs/pricing
- Alibaba Cloud Model Studio pricing (International, USD) — https://www.alibabacloud.com/help/en/model-studio/model-pricing
- Alibaba Cloud Model Studio 模型价格 (China, CNY) — https://help.aliyun.com/zh/model-studio/model-pricing
- Alibaba Cloud context cache rules — https://www.alibabacloud.com/help/en/model-studio/context-cache
- Qwen model specs / context windows — https://www.alibabacloud.com/help/en/model-studio/text-generation-model
- Kimi API pricing — https://platform.kimi.ai/docs/pricing/chat
- Kimi model list / deprecations — https://platform.kimi.ai/docs/models.md
- Z.AI pricing — https://docs.z.ai/guides/overview/pricing
- GLM-5.3 docs (1M ctx / 128K out) — https://docs.z.ai/guides/llm/glm-5.3.md
- Volcengine Ark model prices (Doubao, CNY) — https://www.volcengine.com/docs/82379/1099320
- Volcengine Doubao product page — https://ai.volcengine.com/

Secondary / mirrors (used only where official pages were unreachable, and labelled as such):
- OpenRouter model registry — https://openrouter.ai/api/v1/models
- Together AI pricing (fine-tuning tables) — https://www.together.ai/pricing
