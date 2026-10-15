#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把各家的真实 BPE 词表打包成一个紧凑的二进制数据块（再 gzip + base64），
供单文件 HTML 里的 JavaScript 解析，做到「离线 + 精确」分词。

数据来源（全部为官方发布的 tokenizer 文件）：
  deepseek / qwen  : HuggingFace 上的 tokenizer.json（BPE + ByteLevel 预分词）
  cl100k / o200k   : OpenAI tiktoken 的 .tiktoken 词表（经 gpt-tokenizer 分发）

打包格式（little-endian）：
  magic  : "TOK1"
  u8     : encoding 数量 N
  重复 N 次:
     u8   : 名称长度
     ...  : 名称 (ascii)
     u16  : idOffset（rank 0 对应的 token id）
     u32  : 表项数量 count
     u32  : 特殊 token 数量 S
     重复 S 次: u32 id + u16 字节长度 + 字节内容
     count 次: u16 长度 + 字节内容   （长度为 0 表示该 rank 是空洞）
"""

import base64
import gzip
import io
import json
import os
import struct
import sys
import tempfile
import urllib.request

CACHE = os.path.join(tempfile.gettempdir(), "d-token-calc-cache")
os.makedirs(CACHE, exist_ok=True)

HF = "https://hf-mirror.com/{repo}/resolve/main/tokenizer.json"
NPM = "https://cdn.jsdelivr.net/npm/gpt-tokenizer@2.9.0/data/{name}.tiktoken"
NPM_FALLBACK = "https://unpkg.com/gpt-tokenizer@2.9.0/data/{name}.tiktoken"


def fetch(url, cache_name):
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    print("  downloading %s" % url, file=sys.stderr)
    tmp = path + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "token-calculator-builder/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, path)
    return path


# ---------------------------------------------------------------- byte-level

def bytes_to_unicode():
    """GPT-2 / ByteLevel 的 byte <-> unicode 映射（与 HF tokenizers 一致）。"""
    bs = list(range(ord("!"), ord("~") + 1)) + \
         list(range(ord("\u00a1"), ord("\u00ac") + 1)) + \
         list(range(ord("\u00ae"), ord("\u00ff") + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return {b: chr(c) for b, c in zip(bs, cs)}


B2U = bytes_to_unicode()
U2B = {v: k for k, v in B2U.items()}


def token_to_bytes(tok):
    """ByteLevel 词表串 -> 真实字节；非 ByteLevel 字符（特殊 token）按 UTF-8 存。"""
    if all(c in U2B for c in tok):
        return bytes(U2B[c] for c in tok)
    return tok.encode("utf-8")


def load_hf(path):
    """读取 HF tokenizer.json，返回 (按 rank 排列的字节表, idOffset, 特殊 token 列表)。"""
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    model = doc["model"]
    assert model["type"] == "BPE", model["type"]
    vocab = model["vocab"]          # token 串 -> id
    merges = model["merges"]        # 合并顺序即 rank 顺序

    id_of = {tok: i for tok, i in vocab.items()}
    specials = [(t["id"], t["content"]) for t in doc.get("added_tokens", [])]
    special_ids = {i for i, _ in specials}

    # rank 顺序：先 256 个单字节 token，再按 merges 顺序
    ranked = {}
    for b in range(256):
        tok = B2U[b]
        if tok in id_of:
            ranked[id_of[tok]] = bytes([b])

    for m in merges:
        # HF 有两种写法：["a","b"] 或 "a b"（空格只是分隔符，不是 token 内容，
        # 因为 ByteLevel 的空格是 U+0120，不会出现字面空格）
        tok = "".join(m.split(" ")) if isinstance(m, str) else "".join(m)
        rid = id_of.get(tok)
        if rid is None:
            raise SystemExit("merge token missing from vocab: %r" % tok)
        ranked[rid] = token_to_bytes(tok)

    # 非排名内的 id（特殊 token）不进 BPE 表
    ids = [i for i in ranked if i not in special_ids]
    lo, hi = min(ids), max(ids)
    table = [ranked.get(i) for i in range(lo, hi + 1)]  # None 表示空洞或特殊 token
    return table, lo, specials


def load_tiktoken(path):
    """读取 tiktoken 的 base64 词表，返回同样结构。"""
    entries = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            b64, rank = line.split(" ")
            entries.append((int(rank), base64.b64decode(b64)))
    entries.sort()
    lo = entries[0][0]
    hi = entries[-1][0]
    table = [None] * (hi - lo + 1)
    for rank, raw in entries:
        table[rank - lo] = raw
    return table, lo, []


# tiktoken 的特殊 token（官方定义，此处内联以保持可复现）
TIKTOKEN_SPECIALS = {
    "cl100k": [
        (100257, "<|endoftext|>"), (100258, "<|fim_prefix|>"), (100259, "<|fim_middle|>"),
        (100260, "<|fim_suffix|>"), (100276, "<|endofprompt|>"),
    ],
    "o200k": [
        (199999, "<|endoftext|>"), (200000, "<|fim_prefix|>"), (200001, "<|fim_middle|>"),
        (200002, "<|fim_suffix|>"), (200003, "<|im_start|>"), (200004, "<|im_end|>"),
        (200005, "<|endofprompt|>"),
    ],
}


# ---------------------------------------------------------------- packing

def pack_encoding(name, table, id_offset, specials):
    out = bytearray()
    nb = name.encode("ascii")
    out += struct.pack("<B", len(nb)) + nb
    out += struct.pack("<HI", id_offset, len(table))
    # 特殊 token
    spec = [(i, c.encode("utf-8")) for i, c in specials]
    out += struct.pack("<I", len(spec))
    for i, cb in spec:
        out += struct.pack("<IH", i, len(cb)) + cb
    # BPE 表
    for t in table:
        if t is None:
            out += struct.pack("<H", 0)
        else:
            out += struct.pack("<H", len(t)) + t
    return bytes(out)


def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_path = os.path.join(repo_root, "build", "tokenizer_data.b64")

    specs = [
        ("deepseek", "hf", HF.format(repo="deepseek-ai/DeepSeek-V3"), "deepseek_tokenizer.json"),
        ("qwen",     "hf", HF.format(repo="Qwen/Qwen2.5-7B-Instruct"), "qwen25_tokenizer.json"),
        ("qwen38",   "hf", HF.format(repo="Qwen/Qwen3.8-27B"), "qwen38_tokenizer.json"),
        ("glm",      "hf", HF.format(repo="zai-org/GLM-5"), "glm5_tokenizer.json"),
        ("cl100k",   "tik", NPM.format(name="cl100k_base"), "cl100k_base.tiktoken"),
        ("o200k",    "tik", NPM.format(name="o200k_base"), "o200k_base.tiktoken"),
    ]

    blob = bytearray(b"TOK1")
    blob += struct.pack("<B", len(specs))
    meta = {}

    for name, kind, url, cache_name in specs:
        print("[*] %s" % name, file=sys.stderr)
        path = fetch(url, cache_name)
        if kind == "hf":
            table, off, specials = load_hf(path)
        else:
            table, off, specials = load_tiktoken(path)
            specials = TIKTOKEN_SPECIALS[name]
        blob += pack_encoding(name, table, off, specials)
        filled = sum(1 for t in table if t is not None)
        meta[name] = {"count": len(table), "idOffset": off, "tokens": filled,
                      "specials": len(specials)}
        print("    table=%d filled=%d idOffset=%d specials=%d"
              % (len(table), filled, off, len(specials)), file=sys.stderr)

    gz = gzip.compress(bytes(blob), 9)
    b64 = base64.b64encode(gz).decode("ascii")
    with open(out_path, "w", encoding="ascii") as f:
        f.write(b64)

    print("[ok] raw=%d gzip=%d base64=%d -> %s"
          % (len(blob), len(gz), len(b64), out_path), file=sys.stderr)
    with open(os.path.join(repo_root, "build", "tokenizer_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
