"""Extract evidence-backed relationships for the offline learning workspace.

This inventory does not execute YAML expressions or claim runtime activation.
"""
import re
from collections import defaultdict


AREAS = [
    dict(id='entry', title='入口与装配', subtitle='应用如何组合起来', groups=['boot','bundle','sdk','preset'], color='#e3b46e'),
    dict(id='client', title='界面与宿主', subtitle='输入、展示与远程通信', groups=['client','host','api'], color='#73c6b6'),
    dict(id='agent', title='智能体与模型', subtitle='接纳输入，推进每一步', groups=['core','llm','context','compaction'], color='#8faee2'),
    dict(id='tools', title='工具与执行', subtitle='读文件、运行命令和终端', groups=['fs','shell','subprocess','ssh','terminal','ptc-runtime','lsp'], color='#baa3df'),
    dict(id='connect', title='外部能力', subtitle='浏览器、网页与协议接入', groups=['web','computer-use','browser-use','mcp','acp','webhook','hooks','skill','extensions'], color='#8dc5de'),
    dict(id='work', title='任务与协作', subtitle='委派、计划与持续工作', groups=['subagent','jobs','workflow','todo','plan','goal','schedule'], color='#d7a1ba'),
    dict(id='data', title='会话与数据', subtitle='保留事实，恢复状态', groups=['session','session-query','attachment','spill','storage','workspace','deliverables','feedback','document'], color='#a5c889'),
    dict(id='safety', title='权限与设置', subtitle='约束执行，管理偏好', groups=['sandbox','guard','interaction','identity','settings','credentials'], color='#db997e'),
    dict(id='foundation', title='基础与实验', subtitle='类型、验证和可选探索', groups=['typert','util','test-support','runtime-diagnostics','experimental'], color='#a8b7c0'),
]


def build_matrix(files, packages, root, curated):
    by_path = {p['path']: p for p in packages}
    by_name = {p['name']: p for p in packages}
    aliases = defaultdict(set)
    for p in packages:
        for alias in (p['short'], p['path'].split('/')[-1]):
            aliases[alias].add(p['name'])
    def refs(cell):
        result = set()
        for path in re.findall(r'\]\(\.\./(packages/[^/)]+/[^/)]+)\)', cell):
            if path in by_path:
                result.add(by_path[path]['name'])
        for alias in re.findall(r'`([^`]+)`', re.sub(r'\[[^\]]+\]\([^)]+\)', '', cell)):
            if len(aliases[alias]) == 1:
                result.update(aliases[alias])
        return sorted(result)

    edges = []
    for p in packages:
        for dependency in p['deps']:
            if dependency in by_name:
                edges.append(dict(source=p['name'], target=dependency, kind='dependency', label='声明依赖', file=p['path']+'/package.json', line=1))
    services = []
    capability_file = 'docs/capability-seams.md'
    for lineno, line in enumerate(files[capability_file].splitlines(), 1):
        if not line.startswith('| `ctx.'):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if len(cells) < 7:
            raise ValueError('Unexpected capability table format')
        name = cells[0].strip('`')
        definition, providers, consumers = refs(cells[2]), refs(cells[3]), refs(cells[4])
        services.append(dict(name=name, definition=definition, providers=providers, consumers=consumers, file=capability_file, line=lineno))
        for sources, label in ((providers, '提供实现'), (consumers, '使用服务')):
            for source in sources:
                for target in definition:
                    if source != target:
                        edges.append(dict(source=source, target=target, kind='service', label=label+' '+name, file=capability_file, line=lineno))
    events = []
    event_file = 'docs/event-producer-consumer.md'
    for lineno, line in enumerate(files[event_file].splitlines(), 1):
        if not re.match(r'^\| `[^`]+` \| `(?:emit|serial|parallel|waterfall)', line):
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if len(cells) < 5:
            raise ValueError('Unexpected event table format')
        name, mode = cells[0].strip('`'), cells[1].strip('`')
        dispatchers, listeners = refs(cells[3]), refs(cells[4])
        events.append(dict(name=name, mode=mode, dispatchers=dispatchers, listeners=listeners, file=event_file, line=lineno))
        for source in dispatchers:
            for target in listeners:
                if source != target:
                    edges.append(dict(source=source, target=target, kind='event', label=name+' · '+mode, file=event_file, line=lineno))

    # Retain every named config row as evidence, including deferred preset rows.
    # YAML tags are read as inert strings; no profile or installation is mutated.
    import yaml
    class InventoryLoader(yaml.SafeLoader):
        pass
    InventoryLoader.add_constructor('tag:yaml.org,2002:js', lambda loader,node: {'jsExpression':loader.construct_scalar(node)})
    bundles = []
    for p in packages:
        if not p.get('bundle'):
            continue
        patches = p['bundle']['patch']
        if isinstance(patches, str):
            patches = [patches]
        rows, overrides = [], []
        for patch in patches:
            file = p['path']+'/'+patch.removeprefix('./')
            if file not in files:
                files[file] = (root/file).read_text(encoding='utf-8')
            doc = yaml.load(files[file], Loader=InventoryLoader)
            def walk(value, location, ancestor_disabled=False):
                if isinstance(value, list):
                    for i, row in enumerate(value):
                        walk(row, location+'/'+str(i), ancestor_disabled)
                elif isinstance(value, dict):
                    disabled = value.get('disabled', False)
                    state = 'disabled' if disabled is True or ancestor_disabled else 'conditional' if isinstance(disabled, dict) else 'declared'
                    name = value.get('name')
                    if isinstance(name, str) and name.startswith('@'):
                        package = '/'.join(name.split('/')[:2])
                        if package in by_name:
                            line = next((i for i,s in enumerate(files[file].splitlines(),1) if name in s),1)
                            rows.append(dict(id=value.get('id',''), package=package, module=name, file=file, line=line,
                                             state=state, expression=disabled.get('jsExpression') if isinstance(disabled,dict) else None,
                                             location=location, deferred='/config/' in location))
                    for key, child in value.items():
                        if key != 'jsExpression':
                            walk(child, location+'/'+str(key), state=='disabled')
            walk(doc, 'patch')
            if isinstance(doc,list):
                for value in doc:
                    if isinstance(value,dict) and 'id' in value and 'disabled' in value:
                        overrides.append(dict(id=value['id'],disabled=value['disabled'],file=file))
        bundles.append(dict(name=p['name'], files=[p['path']+'/'+s.removeprefix('./') for s in patches], rows=rows, overrides=overrides))

    profile_file = 'packages/boot/app-boot/src/profile.ts'
    text = files[profile_file].split('export const PROFILE_TEMPLATES:',1)[1].split('\n}',1)[0]
    profiles = []
    descriptions={'web':'浏览器交互界面与 Host 服务。','headless':'单次任务执行与终端输出，不挂载 Web 应用。','sdk':'通过 JSON-RPC 使用智能体能力。','sdk-minimal':'独立的最小 SDK 组合，不叠加 base。','acp':'面向自动化客户端的 ACP 协议入口。'}
    for match in re.finditer(r"(?:'([^']+)'|(\w+)):\s*\{\s*bundles:\s*\[([^\]]+)\]",text):
        name=match.group(1) or match.group(2)
        profiles.append(dict(id=name, bundles=re.findall(r"'([^']+)'",match.group(3)), file=profile_file, description=descriptions.get(name,name)))
    web = next(p for p in profiles if p['id']=='web')
    profiles.append(dict(id='desktop',bundles=web['bundles'][:],file='apps/desktop/src/project-manager.ts',
                         description='Electron 管理保留的 desktop profile，复用 Web bundle。桌面宿主还负责窗口、IPC 和打包资源；不是普通 CLI profile。'))
    for p in profiles:
        selected = [next(b for b in bundles if b['name']==name) for name in p['bundles']]
        rows = [dict(row,bundle=b['name']) for b in selected for row in b['rows']]
        for b in selected:
            for override in b['overrides']:
                for row in rows:
                    if row['id']==override['id'] and not row['deferred']:
                        v=override['disabled']
                        row['state']='disabled' if v is True else 'conditional' if isinstance(v,dict) else 'declared'
                        row['overrideFile']=override['file']
        p['rows']=rows

    for area in AREAS:
        area['packages']=[p['name'] for p in packages if p['group'] in area['groups']]
    assert sum(len(a['packages']) for a in AREAS)==len(packages), 'Every package needs a learning area'
    for scene in curated['scenes']:
        for step in scene['steps']:
            if step['package'] not in by_name:
                raise ValueError('Missing scene package: '+step['package'])
            source=files[step['file']]
            needle=step.get('find','')
            if needle and needle not in source:
                raise ValueError('Missing scene source: '+step['file']+' '+needle)
            step['line']=source[:source.index(needle)].count('\n')+1 if needle else 1
    return dict(areas=AREAS, edges=edges, services=services, events=events,bundles=bundles,profiles=profiles,scenes=curated['scenes'],
                reviewedHead=curated['reviewedHead'], formatVersion=4)
