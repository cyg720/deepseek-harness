"""Build the offline reader and verify authored report links without network access."""

from __future__ import annotations

import hashlib
import html
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

import markdown


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parents[2]
FILES = sorted(ROOT.glob('[0-6][0-9]-*.md'))
assert len(FILES) == 7, f'Expected seven chapters, found {len(FILES)}'
CHAPTERS = {path.resolve(): f'chapter-{index}' for index, path in enumerate(FILES)}
documents = []
all_sources: set[Path] = set()
errors: list[str] = []
link_count = 0

for path in FILES:
    source = path.read_text(encoding='utf-8')
    if not source.endswith('\n') or source.endswith('\n\n'):
        errors.append(f'{path.name}: expected exactly one final newline')
    if len(re.findall(r'^```', source, re.M)) % 2:
        errors.append(f'{path.name}: unbalanced code fences')
    body = re.sub(r'\A---\n.*?\n---\n', '', source, count=1, flags=re.S)
    rendered = markdown.markdown(body, extensions=['tables', 'fenced_code', 'toc', 'sane_lists'], output_format='xhtml')
    tree = ET.fromstring(f'<section>{rendered}</section>')
    title = tree.find('h1')
    assert title is not None
    documents.append({'path': path, 'tree': tree, 'source': source, 'title': ''.join(title.itertext()),
                      'ids': {element.get('id') for element in tree.iter() if element.get('id')}})

by_path = {entry['path'].resolve(): entry for entry in documents}
for entry in documents:
    path = entry['path']
    chapter = CHAPTERS[path.resolve()]
    for element in entry['tree'].iter():
        original_id = element.get('id')
        if original_id:
            element.set('id', f'{chapter}-{original_id}')
        href = element.get('href')
        if not href:
            continue
        link_count += 1
        if href.startswith(('https://', 'http://', 'mailto:')):
            element.set('rel', 'noreferrer')
            continue
        parsed = urlsplit(href)
        fragment = unquote(parsed.fragment)
        local = unquote(parsed.path)
        if re.match(r'^/[A-Za-z]:/', local):
            target = Path(local[1:]).resolve()
        else:
            target = (path.parent / local).resolve() if local else path.resolve()
        if not target.exists():
            errors.append(f'{path.name}: missing link {href}')
            continue
        if target in by_path:
            if fragment and fragment not in by_path[target]['ids']:
                errors.append(f'{path.name}: missing anchor {href}')
            element.set('href', '#' + CHAPTERS[target] + (f'-{fragment}' if fragment else ''))
        else:
            element.set('href', target.as_uri() + (f'#{fragment}' if fragment else ''))
            if target.is_relative_to(REPOSITORY) and not target.is_relative_to(ROOT):
                all_sources.add(target)
    entry['tree'].set('id', chapter)
    entry['tree'].set('class', 'chapter')

assert not errors, '\n'.join(errors)
navigation = ''.join(f'<a href="#{CHAPTERS[entry["path"].resolve()]}"><span>{index:02}</span>{html.escape(entry["title"])}</a>'
                     for index, entry in enumerate(documents))
content = ''.join(ET.tostring(entry['tree'], encoding='unicode', method='html') for entry in documents)
shell = r'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>DeepSeek Harness 原生桌面端技术分析</title>
<style>
:root{color-scheme:light;--paper:#fff;--bg:#f1f4f8;--ink:#1b2a3b;--muted:#596c80;--line:#dce4ed;--accent:#1459c2;--code:#f2f5fa}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.9 "Segoe UI","Microsoft YaHei",sans-serif}
a{color:var(--accent);text-underline-offset:3px}aside{position:fixed;inset:0 auto 0 0;width:290px;background:#14273f;color:#e8effa;padding:30px 23px;overflow:auto}
.eyebrow{font-size:12px;letter-spacing:2px;color:#9cb7d5}.brand{font-size:23px;line-height:1.5;margin:12px 0 22px;font-weight:700}
aside a{display:block;padding:12px 4px;border-top:1px solid #2c4058;color:#d5e4f6;text-decoration:none;font-size:14px;line-height:1.6}aside a:hover{color:white;background:#203a59}aside a span{display:block;font-size:11px;color:#8dabc9}
.sidebar-note{font-size:12px;color:#adbed1;margin-top:24px}main{margin-left:290px;max-width:1450px;padding:38px 48px 80px}
.hero{background:linear-gradient(125deg,#153758,#1e5680);color:white;padding:36px 40px;border-radius:16px;box-shadow:0 8px 30px #162d4812;margin-bottom:28px}
.hero h1{font-size:32px;line-height:1.5;margin:10px 0 16px}.hero p{margin:8px 0;color:#dae9fa}.pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}.pills span{padding:4px 12px;border:1px solid #769aba;border-radius:20px;font-size:12px}
.notice{margin:24px 0;background:#fff7e6;color:#694800;border:1px solid #ebcc88;padding:18px 22px;border-radius:10px;font-size:14px}.notice strong{color:#6b4500}
.tools{display:flex;gap:10px;margin:18px 0 26px}button{cursor:pointer;border:1px solid var(--line);border-radius:7px;background:var(--paper);color:var(--ink);padding:9px 15px;font:inherit;font-size:13px}
.chapter{background:var(--paper);padding:32px 40px;border:1px solid var(--line);border-radius:12px;margin-bottom:24px;overflow-wrap:anywhere;min-width:0}
.chapter h1{font-size:27px;line-height:1.5;margin:0 0 22px}.chapter h2{font-size:21px;line-height:1.6;margin:34px 0 15px;padding-bottom:9px;border-bottom:1px solid var(--line)}.chapter h3{font-size:18px;margin:26px 0 10px}.chapter p{margin:14px 0}.chapter li{margin:5px 0}
table{display:block;width:100%;overflow:auto;border-collapse:collapse;font-size:14px;line-height:1.7;margin:20px 0}th,td{border:1px solid var(--line);padding:11px 13px;text-align:left;vertical-align:top;min-width:110px}th{background:var(--code);font-weight:650}tr:nth-child(even) td{background:color-mix(in srgb,var(--code) 40%,var(--paper))}
code{font-family:Consolas,"Cascadia Code",monospace;font-size:.87em;background:var(--code);padding:2px 5px;border-radius:4px}pre{max-width:100%;overflow:auto;background:var(--code);border:1px solid var(--line);border-radius:8px;padding:18px 20px;line-height:1.7}pre code{padding:0;background:none;white-space:pre;overflow-wrap:normal}
blockquote{border-left:4px solid var(--accent);margin:20px 0;padding:1px 20px;background:var(--code)}.chapter:target{outline:2px solid #80b4f4}.footer{font-size:13px;color:var(--muted);padding:15px}
body.dark{color-scheme:dark;--paper:#162638;--bg:#0e1926;--ink:#e0e8f4;--muted:#acbdd2;--line:#35475d;--accent:#8ec4ff;--code:#102033}
@media(max-width:1050px){aside{width:235px;padding:24px 17px}main{margin-left:235px;padding:26px}.chapter{padding:25px}.hero{padding:28px}}
@media(max-width:720px){aside{position:static;width:auto;padding:22px}aside nav{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.brand{font-size:20px;margin:8px 0 15px}.sidebar-note{margin:14px 0 0}main{margin:0;padding:16px}.hero{padding:24px}.hero h1{font-size:26px}.chapter{padding:21px 18px}.chapter h1{font-size:24px}.chapter h2{font-size:20px}th,td{padding:9px;min-width:120px}}
@media print{aside,.tools{display:none}body{background:white;color:black;font-size:10pt}main{margin:0;max-width:none;padding:0}.hero{background:white;color:black;box-shadow:none;padding:0;border:0}.hero p{color:#333}.pills{display:none}.notice{background:white;border:1px solid #999;color:black}.chapter{border:0;padding:0;margin:0;break-before:page}.chapter h2,.chapter h3{break-after:avoid}table{display:table;font-size:9pt}pre{white-space:pre-wrap}pre code{white-space:pre-wrap}a{color:#174a82}tr,pre{break-inside:avoid}}
</style></head><body>
<aside><div class="eyebrow">SOURCE → DESKTOP</div><div class="brand">原生桌面端<br>技术分析与操作教程</div><nav>__NAV__</nav><p class="sidebar-note">本地源码基线 · 2026-09-13<br>按章节阅读，使用 Ctrl+F 搜索。<br>源码链接指向本机仓库；外部官方链接需要网络。</p></aside>
<main><header class="hero"><div class="eyebrow">DEEPSEEK HARNESS · WINDOWS FIRST</div><h1>从看懂源码，到制作桌面程序</h1><p>Electron 外壳、独立 Node Host、插件扩展与安装包：面向技术新手的完整阅读路径。</p><div class="pills"><span>7 篇分层报告</span><span>PowerShell 分步操作</span><span>真实命令与错误证据</span><span>离线可读</span></div></header>
<div class="notice"><strong>实测边界：</strong>源码构建完成；Electron 二进制下载未完成，尚未验收窗口；Windows 安装包在 fs-ext 载荷检查处失败。请先阅读第 05、06 篇中的阻塞与修复建议。</div>
<div class="tools"><button type="button" onclick="window.print()">打印 / 保存为 PDF</button><button type="button" onclick="document.body.classList.toggle('dark')">切换明暗</button><button type="button" onclick="window.scrollTo({top:0,behavior:'smooth'})">返回顶部</button></div>
__CONTENT__<footer class="footer">本页由同目录七篇 Markdown 原稿生成。截图与阅读页验证只证明报告可读，不代表桌面应用已运行。</footer></main></body></html>'''
output = ROOT / '桌面端技术分析.html'
output.write_text(shell.replace('__NAV__', navigation).replace('__CONTENT__', content) + '\n', encoding='utf-8')
keywords = ['createWindow', 'protocol.handle', 'nodeIntegration', 'contextIsolation', 'DESKTOP_HOST_PROTOCOL_VERSION',
            'runDesktopHost', 'DESKTOP_PIPE_CHUNK_BYTES', 'NODE_VERSION', 'DESKTOP_PROFILE_BUNDLES',
            'DESKTOP_REGISTRY', 'checkFsExt', 'prepare:dsh', 'build:official', 'DSH_DESKTOP_APP_ID',
            'DSH_CLIENT_TITLE', 'DOWNLOAD_TEST_ORIGIN', 'fixedOrigin', 'verifyBuildArtifacts']
evidence = []
for path in sorted(all_sources):
    if not path.is_file():
        continue
    source = path.read_text(encoding='utf-8-sig', errors='replace')
    matches = [{'line': number, 'keywords': [key for key in keywords if key in line]}
               for number, line in enumerate(source.splitlines(), 1) if any(key in line for key in keywords)]
    evidence.append({'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'matches': matches})
(ROOT / 'validation/source-evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
summary = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'chapters': len(FILES), 'markdownLinksChecked': link_count,
           'sourceFiles': len(evidence), 'characters': sum(len(entry['source']) for entry in documents),
           'htmlBytes': output.stat().st_size, 'errors': errors, 'html': str(output)}
(ROOT / 'validation/report-validation.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
