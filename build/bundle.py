#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 index.html + src/*.js + src/*.css + 词表数据 打包成一个自包含的
单文件 HTML（无需服务器、可直接双击打开、可离线使用）。
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def main():
    html = read(os.path.join(ROOT, "index.html"))
    css = read(os.path.join(ROOT, "src", "styles.css"))
    encoder = read(os.path.join(ROOT, "src", "encoder.js"))
    models = read(os.path.join(ROOT, "src", "models.js"))
    app = read(os.path.join(ROOT, "src", "app.js"))
    data = read(os.path.join(HERE, "tokenizer_data.b64")).strip()

    # 内联 CSS
    html = html.replace(
        '<link rel="stylesheet" href="src/styles.css">',
        "<style>\n" + css + "\n</style>",
    )

    # 内联词表（放在 encoder.js 之前，供其读取）
    import json
    data_tag = "<script>window.__TOKEN_DATA__=" + json.dumps(data) + ";</script>\n"

    scripts = (
        data_tag
        + "<script>\n" + encoder + "\n</script>\n"
        + "<script>\n" + models + "\n</script>\n"
        + "<script>\n" + app + "\n</script>"
    )

    # 替换三个 script 标签
    html = re.sub(
        r'<script src="src/encoder\.js"></script>\s*'
        r'<script src="src/models\.js"></script>\s*'
        r'<script src="src/app\.js"></script>',
        lambda m: scripts,
        html,
    )

    leftover = re.findall(r'<script src="[^"]*"></script>|<link[^>]*href="src/[^"]*"', html)
    if leftover:
        print("[warn] 仍有未内联的外部引用: %s" % leftover, file=sys.stderr)

    # 静态版：即使没有 fetch 也能跑（单文件里不会有 fetch 路径）
    html = html.replace(
        "<title>Token 计算器 · 精确分词与 API 成本估算</title>",
        "<title>Token 计算器 · 精确分词与 API 成本估算（单文件版）</title>",
    )

    out = os.path.join(ROOT, "Token计算器-单文件版.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print("[ok] %s  (%.2f MB)" % (out, os.path.getsize(out) / 1048576), file=sys.stderr)


if __name__ == "__main__":
    main()
