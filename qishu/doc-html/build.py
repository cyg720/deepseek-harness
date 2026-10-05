"""Build an offline source atlas from tracked repository files and reachable history.

Run with Python 3.11+: python qishu/doc-html/build.py. Only this output directory
is written. History summaries are classified metadata, not inferred diff reviews.
"""
from pathlib import Path
from collections import Counter
import base64
import datetime
import gzip
import hashlib
import json
import re
import subprocess
from matrix_data import build_matrix
from features_data import build_features

OUT = Path(__file__).resolve().parent
ROOT = OUT.parent.parent


def git(*args):
    return subprocess.check_output(['git', '-c', 'core.quotepath=false', *args], cwd=ROOT).decode('utf-8', errors='replace')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8-sig')


GROUPS = {
 'document':'文档处理', 'core':'智能体核心', 'api':'远程接口', 'typert':'类型与协议', 'llm':'模型接入',
 'shell':'命令执行', 'subprocess':'子进程', 'ssh':'远程执行', 'terminal':'持久终端',
 'ptc-runtime':'程序化工具调用', 'sandbox':'沙箱隔离', 'deliverables':'交付物',
 'fs':'文件系统', 'lsp':'语言服务', 'skill':'技能加载', 'web':'搜索与网页',
 'computer-use':'计算机操作', 'browser-use':'浏览器操作', 'compaction':'上下文压缩',
 'context':'请求上下文', 'subagent':'子智能体', 'jobs':'后台任务', 'bundle':'插件组合',
 'workflow':'工作流', 'webhook':'Webhook 接入', 'todo':'任务清单', 'plan':'计划模式',
 'goal':'目标管理', 'schedule':'定时跟进', 'preset':'智能体预设', 'guard':'执行守卫',
 'extensions':'运行时扩展', 'hooks':'外部产品桥接', 'session':'会话持久化',
 'session-query':'会话查询', 'attachment':'附件', 'spill':'长输出存储', 'storage':'通用存储',
 'workspace':'工作空间', 'feedback':'反馈', 'identity':'身份', 'settings':'设置',
 'credentials':'凭据与授权', 'acp':'ACP 协议', 'interaction':'人机交互', 'boot':'启动装配',
 'sdk':'SDK', 'host':'界面宿主', 'client':'浏览器界面', 'mcp':'MCP 接入',
 'experimental':'实验能力', 'test-support':'测试基础设施', 'runtime-diagnostics':'运行时检查',
 'util':'基础工具', 'apps':'产品入口', 'docs':'文档', 'scripts':'构建与校验',
 'python':'Python SDK', 'native':'原生模块', 'vendor':'上游依赖副本', 'website':'文档网站',
 '.github':'持续集成', '.agents':'开发规范', 'snapshots':'会话快照', 'benchmarks':'性能基准',
}


def main():
    tracked = git('ls-files', '-z').split('\0')
    files = {}
    for p in tracked:
        if not p or p.startswith(('qishu/', 'vendor/', '.agents/notes/archived/')):
            continue
        suffix = Path(p).suffix
        include = ((p.startswith(('packages/', 'apps/', 'python/', 'native/')) and
                    ('/src/' in p or p.endswith(('README.zh.md', 'README.md', 'package.json', '.patch.yml')))) or
                   (p.startswith('docs/') and suffix == '.md') or
                   p in ('package.json', 'pnpm-workspace.yaml', 'AGENTS.md', 'README.zh.md'))
        if include and suffix in ('.ts','.tsx','.js','.mjs','.py','.rs','.cpp','.h','.css','.md','.json','.yml','.yaml'):
            try:
                files[p] = read(p)
            except (UnicodeError, FileNotFoundError):
                continue
    packages = []
    for p in sorted(tracked):
        if not re.fullmatch(r'packages/[^/]+/[^/]+/package\.json', p):
            continue
        m = json.loads(files[p])
        directory = p.rsplit('/', 1)[0]
        rp = directory + '/README.zh.md'
        md = files[rp]
        summary = re.search(r'## (?:概述|摘要|Summary)\s*\n(.*?)(?=\n## |\Z)', md, re.S)
        summary = summary.group(1).strip() if summary else re.search(r'description: (.+)', md).group(1).strip('"')
        kindmatch = re.search(r'^kind:\s*["\']?([^"\'\n]+)', md, re.M)
        kind = kindmatch.group(1).strip() if kindmatch else 'package-reference'
        entries = [x for x in (directory+'/src/index.ts', directory+'/src/client/index.ts') if x in files]
        if kind == 'package-bundle' or m.get('dsh', {}).get('bundle'):
            role = '插件组合'
        elif kind == 'package-library':
            role = '基础库'
        elif m.get('dsh', {}).get('client'):
            role = '客户端插件'
        else:
            role = '服务 / 插件'
        deps = dict(m.get('dependencies', {}))
        deps.update(m.get('peerDependencies', {}))
        packages.append(dict(name=m['name'], short=m['name'].replace('@deepseek-ai/dsh-', ''),
                             group=directory.split('/')[1], path=directory, role=role,
                             summary=summary, readme=rp, entries=entries, version=m.get('version'),
                             deps=[x for x in deps if x.startswith('@deepseek-ai/')],
                             client=m.get('dsh', {}).get('client'), bundle=m.get('dsh', {}).get('bundle'),
                             sources=[x for x in files if x.startswith(directory+'/src/')]))
    print(f'Collected {len(packages)} packages / {len(files)} embedded files', flush=True)
    curated = json.loads((OUT/'guide.json').read_text(encoding='utf-8'))
    # Resolve anchors against the embedded source, so line links cannot silently drift.
    for flow in curated['flows']:
        for step in flow['steps']:
            source = files[step['file']]
            needle = step.get('find', '')
            if needle and needle not in source:
                raise ValueError(f'Missing source anchor: {step["file"]}: {needle}')
            step['line'] = source[:source.index(needle)].count('\n')+1 if needle else 1
    print('Reading full reachable Git history…', flush=True)
    head = git('rev-parse', 'HEAD').strip()
    cache = OUT / '.history-cache.gz'
    raw = ''
    if cache.exists():
        cached = json.loads(gzip.decompress(cache.read_bytes()))
        if cached['head'] == head:
            raw = cached['raw']
    if not raw:
        raw = git('log', 'HEAD', '--date-order', '--format=%x1e%H%x00%aI%x00%an%x00%P%x00%s%x00%b%x00',
                  '--numstat', '--diff-merges=first-parent')
        cache.write_bytes(gzip.compress(json.dumps({'head':head,'raw':raw},ensure_ascii=False).encode(),mtime=0))
    commits = []
    overrides = json.loads((OUT/'history-zh.json').read_text(encoding='utf-8'))
    kinds = {'feat':'新增功能','fix':'修复问题','docs':'文档更新','test':'测试更新',
             'refactor':'代码重构','perf':'性能优化','chore':'维护调整','build':'构建更新',
             'ci':'持续集成','style':'样式或格式','release':'版本发布','revert':'撤销改动'}
    topics = [('compatib','版本兼容性'),('plugin','插件装配'),('prepar','准备进度'),
              ('session','会话状态'),('chat','聊天界面'),('stream','流式响应'),
              ('snapshot','快照验证'),('sandbox','沙箱执行'),('approval','审批流程'),
              ('tool','工具执行'),('theme','主题样式'),('locale','国际化'),('i18n','国际化'),
              ('doc','文档'),('test','测试'),('config','配置'),('sdk','SDK'),('desktop','桌面端'),
              ('web','Web 界面'),('model','模型接入'),('llm','模型接入'),('agent','智能体'),
              ('build','构建'),('ci','持续集成'),('release','发布'),('persist','持久化'),
              ('migration','数据迁移'),('type','类型'),('memory','记忆'),('file','文件操作'),
              ('terminal','终端'),('browser','浏览器'),('worktree','Git 工作树'),('subprocess','子进程'),
              ('cancel','取消'),('shutdown','关闭流程'),('auth','身份验证'),('security','安全控制')]
    for record in raw.split('\x1e')[1:]:
        fields = record.split('\0', 6)
        if len(fields) != 7:
            raise ValueError('Unexpected git log record')
        sha,date,author,parents,title,body,stat = fields
        changed = []
        for row in stat.strip().splitlines():
            nums = row.split('\t', 2)
            if len(nums) == 3:
                a,d,f = nums
                changed.append([f, int(a) if a.isdigit() else None, int(d) if d.isdigit() else None])
        match = re.match(r'(\w+)(?:\(([^)]+)\))?!?:\s*(.*)', title)
        ismerge = len(parents.split()) > 1
        kind = 'merge' if ismerge else (match.group(1).lower() if match else ('revert' if title.startswith('Revert') else 'other'))
        scope = match.group(2) if match else ''
        areas = Counter()
        for f,_,_ in changed:
            parts = f.split('/')
            group = parts[1] if len(parts)>2 and parts[0]=='packages' else parts[0]
            areas[GROUPS.get(group, group)] += 1
        theme = list(dict.fromkeys(v for k,v in topics if k in title.lower()))[:3]
        action = '合并分支' if ismerge else kinds.get(kind, '代码与资料调整')
        zh = overrides.get(sha[:10])
        explanation = f'{action}。'
        if theme:
            explanation += '标题涉及：'+'、'.join(theme)+'。'
        if areas:
            explanation += '变更文件主要分布在'+'、'.join(x for x,_ in areas.most_common(3))+'。'
        explanation += f'此提交相对'+('第一父提交' if ismerge else '父提交')+f'记录了 {len(changed)} 个文件条目。'
        commits.append(dict(id=sha,date=date,author=author,parents=parents.split(),title=title,
                            body=body.strip(),kind=kind,scope=scope or '',files=changed,
                            zh=zh or explanation,reviewed=bool(zh),topics=theme,
                            added=sum(x[1] or 0 for x in changed),removed=sum(x[2] or 0 for x in changed)))
    assert len(commits) == int(git('rev-list','--count','HEAD').strip())
    meta = dict(head=git('rev-parse','HEAD').strip(),version=json.loads(read('package.json'))['version'],
                generated=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                shallow=git('rev-parse','--is-shallow-repository').strip()=='true',
                dirty=git('status','--porcelain','--untracked-files=no').strip(),
                packageCount=len(packages), fileCount=len(files), commitCount=len(commits),
                explained=sum(c['reviewed'] for c in commits),
                guideReviewedHead=curated['reviewedHead'], guideNeedsReview=head != curated['reviewedHead'],
                groups=GROUPS, historyScope='HEAD 可达的全部本地提交；合并提交统计相对第一父提交',
                sourceScope='受 Git 跟踪的 packages/apps 源码、包说明与 docs 文档；不含 vendor 源码、测试夹具、密钥及运行数据')
    diagram = (OUT/'runtime-map.html').read_text(encoding='utf-8')
    # The renderer's optional web font is unnecessary for offline SVG geometry.
    diagram = re.sub(r'<link\b[^>]*href="https?://[^>]*>', '', diagram, flags=re.S)
    # This renderer omits isPlaying when no guided views are declared. Its motion
    # controller still calls it on pause, so guard that optional generated hook.
    diagram = diagram.replace('Archify.guidedViews && Archify.guidedViews.isPlaying())',
                              'Archify.guidedViews && typeof Archify.guidedViews.isPlaying === "function" && Archify.guidedViews.isPlaying())')
    (OUT/'runtime-map.html').write_text(diagram, encoding='utf-8', newline='\n')
    matrix_guide = json.loads((OUT/'matrix-guide.json').read_text(encoding='utf-8'))
    matrix = build_matrix(files, packages, ROOT, matrix_guide)
    features = build_features(files, packages, matrix, tracked)
    meta['featureCount'] = len(features['items'])
    meta['fileCount'] = len(files)
    meta['matrixCounts'] = {key:len(matrix[key]) for key in ('areas','services','events','edges','profiles','scenes')}
    payload = dict(meta=meta,packages=packages,files=files,commits=commits,guide=curated,
                   diagram=diagram,license=read('LICENSE'),matrix=matrix,features=features)
    packed = base64.b64encode(gzip.compress(json.dumps(payload, ensure_ascii=False,separators=(',',':')).encode(),mtime=0)).decode()
    template = (OUT/'template.html').read_text(encoding='utf-8')
    styles = (OUT/'style.css').read_text(encoding='utf-8') + '\n' + (OUT/'matrix.css').read_text(encoding='utf-8') + '\n' + (OUT/'features.css').read_text(encoding='utf-8')
    scripts = (OUT/'app.js').read_text(encoding='utf-8') + '\n' + (OUT/'matrix.js').read_text(encoding='utf-8') + '\n' + (OUT/'features.js').read_text(encoding='utf-8')
    html = template.replace('/*__STYLE__*/',styles).replace('/*__APP__*/',scripts).replace('__PAYLOAD__',packed)
    (OUT/'index.html').write_text(html,encoding='utf-8',newline='\n')
    manifest = dict(meta=meta,bytes=len(html.encode()),
                    files={p:hashlib.sha256(s.encode()).hexdigest() for p,s in files.items()})
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({**meta,'htmlMB':round(len(html.encode())/1e6,2)},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
