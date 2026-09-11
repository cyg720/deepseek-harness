#!/usr/bin/env python3
"""Build one Markdown snapshot into a portable MD/HTML pair. Python 3.10+, stdlib only.

No business APIs, SQL, network requests or third-party runtime dependencies are used.
Existing destination files are preserved unless --force is explicitly provided.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import tempfile
import uuid

MAX_BYTES = 5 * 1024 * 1024
MARKER = '<!-- prd-workspace:'
SCHEMA_VERSION = 1


def normalise(text: str) -> str:
    return text.replace('\r\n', '\n').replace('\r', '\n')


def safe_json(value: dict) -> str:
    """JSON that cannot close an HTML raw-text element or the metadata comment."""
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            .replace('<', r'\u003c').replace('>', r'\u003e')
            .replace('&', r'\u0026').replace('\u2028', r'\u2028')
            .replace('\u2029', r'\u2029'))


def validate_state(value: dict) -> dict:
    if not isinstance(value, dict) or type(value.get('schemaVersion')) is not int or value.get('schemaVersion') != SCHEMA_VERSION:
        raise ValueError('工作区 schemaVersion 必须为 1。')
    doc_id = value.get('docId')
    if not isinstance(doc_id, str) or not re.fullmatch(r'[a-zA-Z0-9._:-]{1,100}', doc_id):
        raise ValueError('docId 仅允许 1–100 位字母、数字及 . _ : -。')
    version = value.get('version')
    if not isinstance(version, str) or len(version) > 80:
        raise ValueError('version 必须为不超过 80 字符的字符串。')
    revision = value.get('revision')
    if type(revision) is not int or not 0 <= revision <= 9007199254740991:
        raise ValueError('revision 必须为非负安全整数。')
    updated_at = value.get('updatedAt')
    if not isinstance(updated_at, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})', updated_at):
        raise ValueError('updatedAt 必须为有效 ISO 时间。')
    try:
        dt = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            raise ValueError('需要显式时区。')
    except ValueError as exc:
        raise ValueError('updatedAt 必须为带时区的有效 ISO 时间。') from exc
    markdown = value.get('markdown')
    if not isinstance(markdown, str) or len(markdown.encode('utf-8')) > MAX_BYTES:
        raise ValueError('Markdown 正文缺失或大于 5 MiB。')
    return dict(schemaVersion=1, docId=doc_id, version=version, revision=revision,
                updatedAt=updated_at, markdown=normalise(markdown))


def read_markdown(text: str, *, doc_id: str | None = None,
                  version: str | None = None) -> dict:
    text = normalise(text.removeprefix('\ufeff'))
    metadata = dict(schemaVersion=1, docId='prd-' + uuid.uuid4().hex[:16],
                    version='draft', revision=0,
                    updatedAt=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))
    if text.startswith(MARKER):
        boundary = text.find(' -->\n')
        if boundary < 0 or boundary > 10000:
            raise ValueError('工作区元信息注释不完整或过长。')
        metadata = json.loads(text[len(MARKER):boundary])
        if not isinstance(metadata, dict):
            raise ValueError('元信息必须是 JSON 对象。')
        text = text[boundary + 5:]
    if doc_id is not None:
        metadata['docId'] = doc_id
    if version is not None:
        metadata['version'] = version
    return validate_state({**metadata, 'markdown': text})


def encode_markdown(state: dict) -> str:
    state = validate_state(state)
    metadata = {key: value for key, value in state.items() if key != 'markdown'}
    return MARKER + safe_json(metadata) + ' -->\n' + state['markdown']


def render_html(state: dict, template: str) -> str:
    state = validate_state(state)
    match = re.search(r'<script id="prd-runtime">([\s\S]*?)</script>', template)
    if not match:
        raise ValueError('模板缺少唯一 prd-runtime 脚本。')
    if template.count('__CSP__') != 1 or template.count('__PRD_DATA__') != 1:
        raise ValueError('模板占位符必须各出现一次。')
    digest = base64.b64encode(hashlib.sha256(match.group(1).encode('utf-8')).digest()).decode('ascii')
    policy = ("default-src 'none'; script-src 'sha256-" + digest + "'; "
              "style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; "
              "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'")
    result = template.replace('__CSP__', html.escape(policy, quote=True), 1)
    result = result.replace('__PRD_DATA__', safe_json(state), 1)
    title_match = re.search(r'^#\s+(.+)$', state['markdown'], re.MULTILINE)
    title = title_match.group(1).strip() if title_match else '未命名 PRD'
    result = result.replace('<title>PRD · 离线工作台</title>',
                            '<title>' + html.escape(title) + ' · PRD 离线工作台</title>', 1)
    return result


def extract_html_state(document: str) -> dict:
    match = re.search(r'<script id="prd-data" type="application/json">([\s\S]*?)</script>', document)
    if not match:
        raise ValueError('生成 HTML 缺少文档数据。')
    return validate_state(json.loads(match.group(1)))


def build(input_path: Path, out_dir: Path, *, stem: str | None = None,
          doc_id: str | None = None, version: str | None = None,
          force: bool = False, template_path: Path | None = None) -> dict:
    input_path = input_path.resolve()
    if not input_path.is_file():
        raise ValueError(f'输入不是可读文件：{input_path}')
    if input_path.stat().st_size > MAX_BYTES + 10000:
        raise ValueError('输入文件超过限制。')
    state = read_markdown(input_path.read_text(encoding='utf-8'), doc_id=doc_id, version=version)
    if stem is None:
        stem = input_path.stem.removesuffix('.prd')
    if not re.fullmatch(r'[\w.-]{1,100}', stem, flags=re.UNICODE) or stem in {'.', '..'}:
        raise ValueError('stem 必须是无路径分隔符的文件名。')
    template_path = template_path or Path(__file__).resolve().parents[1] / 'assets/offline-shell.html'
    markdown = encode_markdown(state)
    document = render_html(state, template_path.read_text(encoding='utf-8'))
    if read_markdown(markdown) != state or extract_html_state(document) != state:
        raise ValueError('双格式内容一致性检查失败。')
    artifacts = {stem + '.prd.md': markdown, stem + '.prd.html': document}
    manifest = dict(schemaVersion=1, docId=state['docId'], version=state['version'],
                    revision=state['revision'], generatedAt=datetime.now(timezone.utc).isoformat(),
                    validation='已校验生成文件的模型一致性；未执行浏览器、业务代码或业务验收',
                    files={name: dict(bytes=len(content.encode('utf-8')),
                          sha256=hashlib.sha256(content.encode('utf-8')).hexdigest())
                           for name, content in artifacts.items()})
    artifacts[stem + '.manifest.json'] = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    out_dir = out_dir.resolve()
    for name in artifacts:
        dest = out_dir / name
        if dest.resolve() == input_path:
            raise ValueError('输出不得覆盖输入源文件；请选择不同目录或 stem。')
        if dest.exists() and not force:
            raise FileExistsError(f'输出已存在，未覆盖：{dest}；明确允许覆盖时使用 --force。')
    out_dir.mkdir(parents=True, exist_ok=True)
    # Prepare all bytes before replacing any destination; this is not a cross-file atomic transaction.
    with tempfile.TemporaryDirectory(prefix='.prd-build-', dir=out_dir) as staging:
        for name, content in artifacts.items():
            (Path(staging) / name).write_text(content, encoding='utf-8', newline='\n')
        for name in artifacts:
            (Path(staging) / name).replace(out_dir / name)
    return {**manifest, 'paths': [str(out_dir / name) for name in artifacts]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='已完成的 Markdown 文档')
    parser.add_argument('--out-dir', type=Path, required=True)
    parser.add_argument('--stem', help='输出文件前缀，例如 device')
    parser.add_argument('--doc-id', help='稳定文档 ID；省略则保留元信息或生成新 ID')
    parser.add_argument('--version', help='业务版本；省略则保留元信息或标 draft')
    parser.add_argument('--force', action='store_true', help='明确允许覆盖同名输出，不允许覆盖输入')
    args = parser.parse_args()
    try:
        result = build(args.input, args.out_dir, stem=args.stem, doc_id=args.doc_id,
                       version=args.version, force=args.force)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print('构建失败：' + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
