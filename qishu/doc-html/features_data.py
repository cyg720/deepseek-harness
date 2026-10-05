"""Derive a package-owned capability inventory with original source evidence."""
import re


def sections(text):
    matches=list(re.finditer(r'^## (.+)$',text,re.M))
    return [dict(title=m.group(1).strip(),text=text[m.end():matches[i+1].start() if i+1<len(matches) else len(text)].strip(),line=text[:m.start()].count('\n')+1) for i,m in enumerate(matches)]


def build_features(files,packages,matrix,tracked):
    tool_rows={}
    for n,line in enumerate(files['docs/tool-catalog.zh.md'].splitlines(),1):
        if not line.startswith('| `@deepseek-ai/'):
            continue
        cells=[x.strip() for x in line.strip('|').split('|')]
        if len(cells)>=6:
            tool_rows[cells[0].strip('`')]=dict(names=re.findall(r'`([^`]+)`',cells[1]),dependencies=cells[2],effects=cells[3],aliases=cells[4],notes=cells[5],line=n)
    config={s['title'].strip('`'):s for s in sections(files['docs/config-catalog.zh.md'])}
    result=[]
    for p in packages:
        readme=files[p['readme']]
        desc=re.search(r'^description: ["\']?(.*)',readme,re.M)
        title=desc.group(1).strip('"\'') if desc else p['short']
        title=re.split(r'[：。；]',title)[0]
        if len(title)>65:
            title=title[:62]+'…'
        comments=[]
        for entry in p['entries']:
            for m in re.finditer(r'/\*\*([\s\S]*?)\*/',files[entry]):
                comments.append(dict(file=entry,line=files[entry][:m.start()].count('\n')+1,text=re.sub(r'^\s*\* ?', '',m.group(1),flags=re.M).strip()))
        owned=sections(readme)
        result.append(dict(id=p['name'],title=title,area=next(a['id'] for a in matrix['areas'] if p['name'] in a['packages']),
            sections=owned,tools=tool_rows.get(p['name']),config=config.get(p['name']),comments=comments,
            tests=[f for f in tracked if f.startswith(p['path']+'/') and re.search(r'(?:/tests?/|\.(?:test|spec)\.)',f)],
            incoming=[x['name'] for x in packages if p['name'] in x['deps']]))
    assert len(result)==len(packages) and len({f['id'] for f in result})==len(result)
    return dict(items=result,scope='按 packages/*/* 的包职责建立功能条目，工具目录补充具体操作；不等于逐个函数或所有运行时分支的枚举。',toolCount=sum(len(f['tools']['names']) for f in result if f['tools']))
