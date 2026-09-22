"""Assemble the dependency-free HTML from its editable CSS/JS sources."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
p = ROOT / 'prototype'
html = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="MyPI 离线交互原型：Coding Agent、按需工具、并行子任务与管理后台。所有运行均为 Mock。"><title>MyPI · 对话工作台原型</title><style>'''+(p/'styles.css').read_text(encoding='utf-8')+'''</style></head><body><div id="app"></div><dialog id="modal" aria-labelledby="modal-title"></dialog><div id="toast" class="toast" role="status" aria-live="polite"></div><noscript>本交互原型需要启用 JavaScript。不会调用模型或系统命令。</noscript><script>'''+(p/'rules.js').read_text(encoding='utf-8')+'''</script><script>'''+(p/'app.js').read_text(encoding='utf-8')+'''</script></body></html>'''
(p/'index.html').write_text(html,encoding='utf-8')
print(f'Built {p / "index.html"}: {len(html.encode())} bytes')
