#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成参考分词结果，共用一个语料 + 多种编码。
  hf  : HuggingFace tokenizers（官方库，加载本地 tokenizer.json）
  tik : OpenAI tiktoken
输出 expected.json / expected_tokens.json（可选逐 token）。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(os.environ.get("TEMP", "/tmp"), "d-token-calc-cache")

# 名称 -> (类型, 本地文件名)
SOURCES = {
    "deepseek": ("hf", "deepseek_tokenizer.json"),
    "qwen": ("hf", "qwen25_tokenizer.json"),
    "qwen38": ("hf", "qwen38_tokenizer.json"),
    "glm": ("hf", "glm5_tokenizer.json"),
    "cl100k": ("tik", "cl100k_base"),
    "o200k": ("tik", "o200k_base"),
}

# 结构化 + 边界用例语料
CORPUS = [
    "Hello, world!",
    "",
    " ",
    "\n",
    "\n\n\n",
    "    leading and trailing    ",
    "The quick brown fox jumps over the lazy dog.",
    "你好，世界！",
    "我爱北京天安门，天安门上太阳升。",
    "这是一个测试，用于验证中文分词是否精确。",
    "自然语言处理（NLP）是人工智能的重要分支。",
    "中文标点：，。！？；：「」『』（）《》——……",
    "２０２４年１２月３１日，全年 GDP 增长 5.2%。",
    "电话号码 13800138000，身份证 110101199001011234。",
    "1234567890 和 1 2 3 4 5 6 7 8 9 0",
    "价格是 $1,234.56，折扣 20% off！",
    "emoji 测试 😀🎉🚀👍🏽👨‍👩‍👧‍👦🇨🇳",
    "混合 mixed 中英 text 与 numbers 12345 结束",
    "def hello_world(name: str) -> str:\n    return f\"Hello, {name}!\"\n",
    "import numpy as np\nx = np.arange(10).reshape(2, 5)\nprint(x[0, :])\n",
    "SELECT id, name FROM users WHERE created_at > '2024-01-01' ORDER BY id DESC LIMIT 10;",
    "{\"key\": \"value\", \"nested\": {\"arr\": [1, 2, 3]}, \"ok\": true}",
    "https://example.com/path?query=1&lang=zh-CN#fragment",
    "user@example.com and another.person+tag@sub.domain.co.uk",
    "It's a test: they're, we've, I'll, he'd, can't, won't.",
    "CamelCaseWords and snake_case_words and SCREAMING_SNAKE_CASE",
    "tab\tseparated\tvalues",
    "RTL: العربية مرحبا שלום",
    "Русский текст, українська мова, ελληνικά.",
    "日本語のテキスト、ひらがな、カタカナ、漢字。",
    "한국어 텍스트입니다.",
    "Tab\tand   multiple    spaces\nNew lines\n\r\nCRLF",
    "1. First item\n2. Second item\n3. Third item",
    "# Markdown\n\n## Heading\n\n- bullet\n- another\n\n**bold** and *italic*",
    "a" * 500,
    "中" * 500,
    "아" * 200,
    "🎉" * 100,
    ("long text " * 100).strip(),
    ("这是一个很长的中文句子。" * 50),
    "MixedContent123 中英文混排 test 456 结束。",
    "num case: 0 00 000 0000 00000 999999",
    "symbols: !@#$%^&*()_+-=[]{}|;':\",./<>?`~",
    "   \n   space newline combo   \n   ",
    "zero\u200bwidth\u200cjoiner",
    "combining: e\u0301 a\u0300 o\u0308",
    "<｜begin▁of▁sentence｜>Hello<｜end▁of▁sentence｜>",
]


def build(corpus, want_tokens):
    counts = {}
    tokens = {}
    from tokenizers import Tokenizer
    import tiktoken

    for name, (kind, fname) in SOURCES.items():
        if kind == "hf":
            tk = Tokenizer.from_file(os.path.join(CACHE, fname))
            counts[name] = [len(tk.encode(s, add_special_tokens=False).ids) for s in corpus]
            if want_tokens:
                tokens[name] = [tk.encode(s, add_special_tokens=False).tokens for s in corpus]
        else:
            te = tiktoken.get_encoding(fname)
            rows, trows = [], []
            for s in corpus:
                ids = te.encode(s, disallowed_special=())
                rows.append(len(ids))
                if want_tokens:
                    trows.append([te.decode_single_token_bytes(t).decode("utf-8", "replace") for t in ids])
            counts[name] = rows
            if want_tokens:
                tokens[name] = trows
        print("[ref] %s ok" % name, file=sys.stderr)
    return counts, tokens


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "corpus"
    global CORPUS
    if mode == "fuzz":
        corpus = make_fuzz()
    else:
        corpus = CORPUS

    want_tokens = (mode == "corpus")
    counts, tokens = build(corpus, want_tokens)

    base = "fuzz_" if mode == "fuzz" else ""
    with open(os.path.join(HERE, base + "expected.json"), "w", encoding="utf-8") as f:
        json.dump({"corpus": corpus, "expected": counts}, f, ensure_ascii=False)
    if want_tokens:
        with open(os.path.join(HERE, "expected_tokens.json"), "w", encoding="utf-8") as f:
            json.dump({"corpus": corpus, "tokens": tokens}, f, ensure_ascii=False)
    print("[ok] %s expected written (n=%d)" % (mode, len(corpus)), file=sys.stderr)


def make_fuzz():
    import random
    random.seed(20240614)
    POOLS = [
        "abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "0123456789", " \t\n\r", "!@#$%^&*()_+-=[]{}|;':\",./<>?`~\\",
        "的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行"
        "所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无",
        "abcdefghijklmnopqrstuvwxyz".upper(),
    ]
    DEVELOPER = [
        "def f(x): return x*2", "SELECT * FROM t WHERE a>1;",
        "if (a && b) { c(); }", "https://a.b/c?d=1&e=2#f",
        "<div class=\"x\">text</div>", "{\"k\":[1,2,{\"n\":null}]}",
        "console.log(`x=${y}`)", "git commit -m \"fix: bug\"",
        "x => x.map(y => y + 1)", "a[0] += b[1] * c[2] % d[3]",
    ]

    def rand_text(maxlen=120):
        n = random.randint(0, maxlen)
        return "".join(random.choice(random.choice(POOLS)) for _ in range(n))

    def structured():
        kinds = [
            lambda: random.choice(DEVELOPER),
            lambda: " ".join(random.choice(["hello", "世界", "test", "数据", "2024", "café", "naïve", "😀", "日本", "한국"])
                             for _ in range(random.randint(1, 8))),
            lambda: "".join(random.choice(" \n\t") for _ in range(random.randint(1, 12))),
            lambda: "".join(random.choice("0123456789") for _ in range(random.randint(1, 20))),
            lambda: "".join(random.choice("的了一是不我有在中") for _ in range(random.randint(1, 30))),
            lambda: random.choice(["e\u0301", "a\u0300", "o\u0308", "n\u0303"]) * random.randint(1, 4),
            lambda: random.choice(["🇨🇳", "👨‍👩‍👧‍👦", "👍🏽", "😀🎉🚀"]) * random.randint(1, 3),
            lambda: ("word " * random.randint(1, 30)).strip(),
            lambda: ("中文句子。" * random.randint(1, 20)),
            lambda: "".join(chr(random.randint(0x20, 0x2FFF)) for _ in range(random.randint(0, 60))),
        ]
        return random.choice(kinds)()

    out, seen = [], set()
    for _ in range(1500):
        s = rand_text() if random.random() < 0.55 else structured()
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


if __name__ == "__main__":
    main()
