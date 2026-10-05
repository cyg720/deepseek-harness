/* Offline atlas UI. All rendered repository text is escaped before insertion. */
'use strict';
let D, packageByName, filePaths, currentPage = 'overview', activeFlow = 'boot', activeStep = 0;
let packagePage = 0, sourcePage = 0, historyPage = 0, sourceState, timer, toastTimer;
let pkgFilter = { q: '', group: '', role: '' }, srcFilter = { q: '', full: false, type: '' };
let histFilter = { q: '', kind: '', month: '', order: 'new', from: '', to: '' };
let dialogStack = [], seen, bookmarks;
const $ = (s, root = document) => root.querySelector(s);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n).toLocaleString('zh-CN');
const navs = [['overview','项目全景','◈'],['features','功能清单','▤'],['matrix','可视矩阵','⬡'],['flows','运行逻辑','⇢'],['concepts','概念与设计','◇'],['packages','插件与包百科','▦'],['source','源码阅读','⌘'],['custom','二开导航','⊕'],['history','Git 时间线','◷'],['about','版本与更新','⟳']];
const typeNames = {feat:'新增功能',fix:'修复问题',docs:'文档更新',test:'测试更新',refactor:'代码重构',perf:'性能优化',chore:'维护调整',build:'构建更新',ci:'持续集成',release:'版本发布',revert:'撤销改动',merge:'合并提交',style:'样式 / 格式',other:'其他调整'};
function saved(key, fallback) { try { return JSON.parse(localStorage.getItem('qishu-'+key)) ?? fallback; } catch (_error) { return fallback; } }
function save(key, value) { try { localStorage.setItem('qishu-'+key, JSON.stringify(value)); } catch (_error) { /* Reading remains available when file storage is disabled. */ } }
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2600); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制'); }
  catch (_error) {
    const input = document.createElement('textarea'); input.value = text;
    (document.querySelector('dialog[open]') || document.body).append(input); input.select();
    const ok = document.execCommand('copy'); input.remove(); toast(ok ? '已复制' : '此浏览器不允许复制，请选中文本手动复制');
  }
}
function btn(text, attrs = '', extra = '') { return `<button class="btn ${extra}" ${attrs}>${text}</button>`; }
function sourceButton(file, text = '阅读源码 ↗', line = 1) { return `<button class="source-link" data-file="${esc(file)}" data-line="${line}">${esc(text)}</button>`; }
function badge(text, green = false) { return `<span class="badge ${green?'green':''}">${esc(text)}</span>`; }
function heading(kicker, title, desc, side = '') { return `<div class="page-head"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${desc}</p></div>${side}</div>`; }
function plain(md) { return md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*#]/g, ''); }
function goto(page, target = '') { const hash = '#'+page+(target?'/'+encodeURIComponent(target):''); if (location.hash === hash) route(); else location.hash = hash; }
function renderOverview() {
  const m = D.meta;
  $('#main').innerHTML = `<div class="eyebrow">THE PROJECT, EXPLAINED · 从零开始读源码</div>
  <section class="hero"><div><h1>理解整个项目，<br>从一次对话开始。</h1><p>${esc(D.guide.intro)}</p><div class="actions">${btn('开始阅读路线 <span>→</span>','data-nav="flows" data-target="boot"','primary')}${btn('浏览全部插件与包','data-nav="packages"','secondary')}</div></div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="orbit two"></div><div class="core"><b>DSH</b>PLUGIN RUNTIME</div><span class="art-label a">CONTEXT</span><span class="art-label b">SESSION EVENTS</span><span class="art-label c">CORDIS</span></div></section>
  <div class="stats"><div class="stat"><b>${fmt(m.packageCount)}</b><span>项目包 · 中文说明全收录</span></div><div class="stat"><b>04</b><span>源码导读路线 · 可逐步跟随</span></div><div class="stat"><b>${fmt(m.fileCount)}</b><span>内置文件 · 无需联网</span></div><div class="stat"><b>${fmt(m.commitCount)}</b><span>可达提交 · 完整历史索引</span></div></div>
  <div class="section-head"><h2>先看全景，再走进实现</h2><p>概念分层 · 不是严格函数调用顺序</p></div>
  <div class="map-grid">${D.guide.layers.map(l=>`<article class="layer"><div class="eyebrow">${esc(l.tag)}</div>${sourceButton(l.file,'↗')}<h3>${esc(l.title)}</h3><p>${esc(l.description)}</p><div class="tags">${l.groups.map(g=>`<button class="tag" data-group="${g}">${esc(m.groups[g]||g)}</button>`).join('')}</div></article>`).join('')}</div>
  <div class="section-head"><h2>给第一次阅读的你</h2><p>建议顺序 · 时间仅供安排学习</p></div><div class="learning-grid">${D.guide.reading.map((r,i)=>`<button class="reading-card" data-nav="${r.page}" data-target="${r.target||''}"><span>0${i+1} / ${esc(r.minutes)}</span><h3>${esc(r.title)}</h3><p>${esc(r.description)}</p></button>`).join('')}</div>
  <div class="note"><b>阅读提示：</b>先理解“装配什么”，再追踪“如何执行”。本页的六层是学习分类；实际插件依赖、事件模式与激活状态需要结合配置和源码判断。</div>`;
}
function renderFlows() {
  const flow = D.guide.flows.find(f=>f.id===activeFlow) || D.guide.flows[0]; activeFlow = flow.id; activeStep = Math.min(activeStep,flow.steps.length-1);
  const s = flow.steps[activeStep], lines = D.files[s.file].split('\n');
  $('#main').innerHTML = heading('TRACE THE RUNTIME','跟着运行逻辑，深入代码','四条经过源码定位的阅读路线。箭头区分调用、事件、网络传输和持久记录；不是自动生成的完整调用图。')+
  `<div class="flow-tabs">${D.guide.flows.map(f=>`<button class="flow-tab ${f.id===activeFlow?'active':''}" data-flow="${f.id}">${esc(f.title)}</button>`).join('')}</div>
  <div class="split"><p class="small">${esc(flow.description)}</p><div class="actions">${btn(timer?'暂停演示':'▶ 自动演示','data-play')}${btn('打开动态总图 ↗','data-diagram')}</div></div>
  <div class="progress-bar"><span style="width:${(activeStep+1)/flow.steps.length*100}%"></span></div>
  <div class="flow-layout"><div class="step-list">${flow.steps.map((x,i)=>`<button class="step ${i===activeStep?'active':''} ${seen.includes(flow.id+':'+i)?'done':''}" data-step="${i}"><span class="num">${seen.includes(flow.id+':'+i)?'✓':String(i+1).padStart(2,'0')}</span><span>${esc(x.title)}<small>${esc(x.kind)}</small></span></button>`).join('')}</div>
  <article class="step-card enter"><div class="split">${badge(s.kind,true)}<span class="small mono muted">STEP ${String(activeStep+1).padStart(2,'0')} / ${flow.steps.length}</span></div><h2>${esc(s.title)}</h2><p>${esc(s.text)}</p><div class="note">${esc(s.watch)}</div>
  <div class="code-peek"><div class="code-caption"><span>${esc(s.file)}:${s.line}</span><button data-file="${esc(s.file)}" data-line="${s.line}">展开完整源码 ↗</button></div><pre>${lines.slice(s.line-1,s.line+11).map((l,i)=>`<span class="muted">${s.line+i} </span>${syntax(l)}`).join('\n')}</pre></div>
  <details class="question"><summary>想一想：${esc(s.question)}</summary><p>${esc(s.answer)}</p></details>
  <div class="flow-controls">${btn('← 上一步',`data-step="${activeStep-1}" ${activeStep===0?'disabled':''}`)}<button class="quiet" data-read>${seen.includes(flow.id+':'+activeStep)?'✓ 已读，可取消':'○ 标记本步已读'}</button>${btn(activeStep===flow.steps.length-1?'下一条路线 →':'下一步 →',activeStep===flow.steps.length-1?'data-next-flow':`data-step="${activeStep+1}"`,'primary')}</div></article></div>
  <p class="source-hint spacer">阅读进度保存在此浏览器。源码行号在生成时按实际内容定位；断网后仍能跳转。</p>`;
}
function renderPackages() {
  $('#main').innerHTML = heading('PLUGIN ENCYCLOPEDIA','认识每一个插件与包','覆盖 packages/*/* 下全部 '+D.meta.packageCount+' 个包。中文说明来自各包 README；百科中的存在不代表某个 profile 已启用。',badge('307 / 307 中文 README',true))+
  `<div class="toolbar"><input class="input" id="pkg-q" type="search" placeholder="搜索包名、能力或中文说明…" value="${esc(pkgFilter.q)}" aria-label="搜索插件与包"><select id="pkg-group" aria-label="按包组筛选"><option value="">所有包组</option>${[...new Set(D.packages.map(p=>p.group))].sort().map(g=>`<option value="${g}" ${g===pkgFilter.group?'selected':''}>${esc(D.meta.groups[g]||g)} · ${g}</option>`).join('')}</select><select id="pkg-role" aria-label="按包类型筛选"><option value="">所有类型</option>${['服务 / 插件','客户端插件','插件组合','基础库'].map(r=>`<option ${r===pkgFilter.role?'selected':''}>${r}</option>`).join('')}</select></div>
  <div class="filters">${['','core','client','boot','llm','session','bundle','experimental'].map(g=>`<button class="chip ${pkgFilter.group===g?'active':''}" data-pkg-group="${g}">${g?(D.meta.groups[g]||g):'全部'}</button>`).join('')}</div><div id="package-results"></div>`;
  paintPackages();
}
function filteredPackages() { const q=pkgFilter.q.toLowerCase(); return D.packages.filter(p=>(!pkgFilter.group||p.group===pkgFilter.group)&&(!pkgFilter.role||p.role===pkgFilter.role)&&(!q||(p.name+' '+p.summary+' '+p.path).toLowerCase().includes(q))); }
function pages(kind,index,count,size) { const total=Math.max(1,Math.ceil(count/size)); return `<div class="pagination">${btn('← 上一页',`data-page-kind="${kind}" data-index="${index-1}" ${index<=0?'disabled':''}`)}<span>${index+1} / ${total}</span>${btn('下一页 →',`data-page-kind="${kind}" data-index="${index+1}" ${index>=total-1?'disabled':''}`)}</div>`; }
function paintPackages() {
  const list=filteredPackages(); packagePage=Math.min(packagePage,Math.max(0,Math.ceil(list.length/24)-1));
  $('#package-results').innerHTML=`<div class="result-info"><span>${fmt(list.length)} 个结果 · 按包目录排序</span><span>点击查看完整讲解、依赖和源码</span></div><div class="package-grid">${list.slice(packagePage*24,packagePage*24+24).map(p=>`<button class="package-card" data-package="${esc(p.name)}"><div class="meta"><span>${esc(D.meta.groups[p.group]||p.group)}</span><span>${esc(p.role)}</span></div><h3>${esc(p.short)}</h3><p>${esc(plain(p.summary))}</p><small>${esc(p.path)}</small></button>`).join('')}</div>${list.length?'':empty('没有匹配的包，试试更短的名称或清除筛选。')}${pages('packages',packagePage,list.length,24)}`;
}
function empty(text){return `<div class="empty">${text}</div>`;}
function modal(label,html,record){
  if(record) dialogStack.push(record);
  $('#detail-label').innerHTML=(dialogStack.length>1?'<button class="quiet" style="display:inline;margin-right:15px" data-modal-back>← 返回</button>':'')+esc(label);
  $('#detail-content').innerHTML=html; if(!$('#detail').open) $('#detail').showModal(); $('#detail').scrollTop=0;
}
function showPackage(name,tab='readme',remember=true){
  const p=packageByName.get(name); if(!p){toast('此依赖不在项目包目录中');return;}
  let body='';
  if(tab==='readme')body=`<div class="markdown">${markdown(D.files[p.readme],p.readme)}</div>`;
  if(tab==='deps'){
    const reverse=D.packages.filter(x=>x.deps.includes(name));
    body=`<div class="note">下列为 manifest 声明的 dependencies / peerDependencies，不等于完整运行时调用链，也不表示启用状态。</div><h3>依赖的包 · ${p.deps.length}</h3><div class="imports">${p.deps.map(x=>packageByName.has(x)?`<button class="tag" data-package="${esc(x)}">${esc(x.replace('@deepseek-ai/',''))}</button>`:badge(x)).join('')}</div><h3 class="spacer">哪些包声明依赖它 · ${reverse.length}</h3><div class="imports">${reverse.map(x=>`<button class="tag" data-package="${esc(x.name)}">${esc(x.short)}</button>`).join('')||'<p class="small">没有扫描到项目包的直接依赖声明。</p>'}</div><h3 class="spacer">组合与客户端声明</h3><pre class="source-code" style="padding:15px">${esc(JSON.stringify({client:p.client||null,bundle:p.bundle||null},null,2))}</pre>`;
  }
  if(tab==='source')body=`<p class="source-hint">点击任意文件离线阅读；优先看入口，再沿本地 import 深入。</p><div class="source-list">${p.sources.map(f=>sourceRow(f)).join('')||empty('此包没有收录的 src 文件，请查看包配置。')}</div>`;
  modal('插件与包百科',`<div class="eyebrow">${esc(D.meta.groups[p.group]||p.group)} / ${esc(p.role)}</div><h2 class="detail-title">${esc(p.short)}</h2><div class="detail-meta">${esc(p.name)} · ${esc(p.version)}<br>${esc(p.path)}</div><div class="actions">${p.entries.map(f=>btn(f.includes('/client/')?'客户端入口 ↗':'Host / 库入口 ↗',`data-file="${esc(f)}"`)).join('')}${btn('package.json',`data-file="${esc(p.path+'/package.json')}"`)}</div><div class="detail-tabs">${[['readme','中文完整说明'],['deps','依赖与被依赖'],['source','源码文件']].map(([id,t])=>`<button class="${tab===id?'active':''}" data-pkg-tab="${id}" data-name="${esc(name)}">${t}</button>`).join('')}</div>${body}`,remember?{kind:'package',name,tab}:null);
}
function syntax(line){
  const pattern=/(\/\/.*$|\/\*.*?\*\/|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\b(?:export|import|from|type|interface|class|extends|function|async|await|const|let|return|if|else|try|catch|finally|throw|new|private|public|readonly|for|of|while|switch|case|break|default|true|false|null|undefined)\b|\b\d+\b)/g;
  let out='',last=0;
  for(const m of line.matchAll(pattern)){out+=esc(line.slice(last,m.index)); const t=m[0]; const cls=t.startsWith('//')||t.startsWith('/*')?'comment':/^['"`]/.test(t)?'string':/^\d/.test(t)?'number':'keyword';out+=`<span class="syntax-${cls}">${esc(t)}</span>`;last=m.index+t.length;}
  return out+esc(line.slice(last));
}
function sourceRow(f){return `<button class="source-row" data-file="${esc(f)}"><span class="ext">${esc(f.split('.').pop().toUpperCase())}</span><span class="path">${esc(f)}</span><span class="size">${fmt(D.files[f].split('\n').length)} 行 ↗</span></button>`;}
function renderSource(){
  $('#main').innerHTML=heading('READ THE SOURCE','每条路线，都能走进源码','内置源码快照与原始文档。支持路径筛选、源码全文搜索、行号定位、导入跳转和书签。')+
  `<div class="toolbar"><input id="src-q" class="input" type="search" value="${esc(srcFilter.q)}" placeholder="搜索文件路径，例如 agent-loop/src/agent.ts" aria-label="搜索源码"><select id="src-type" aria-label="文件类型"><option value="">全部文件</option>${[['code','源码'],['docs','文档'],['config','配置'],['bookmarks','我的书签']].map(([v,t])=>`<option value="${v}" ${srcFilter.type===v?'selected':''}>${t}</option>`).join('')}</select><label class="check-label"><input id="src-full" type="checkbox" ${srcFilter.full?'checked':''}> 搜索文件内容</label></div><div id="source-results"></div>`;
  paintSource();
}
function paintSource(){
  const q=srcFilter.q.toLowerCase();
  const list=filePaths.filter(f=>(!srcFilter.type||(srcFilter.type==='docs'?f.endsWith('.md'):srcFilter.type==='config'?/\.(json|ya?ml)$/.test(f):srcFilter.type==='bookmarks'?bookmarks.some(b=>b.file===f):/\.(tsx?|[cm]?js|py|rs|cpp|h|css)$/.test(f)))&&(!q||(srcFilter.full?D.files[f].toLowerCase().includes(q):f.toLowerCase().includes(q))));
  sourcePage=Math.min(sourcePage,Math.max(0,Math.ceil(list.length/40)-1));
  const bookmarkRows=srcFilter.type==='bookmarks'?`<div class="imports">${bookmarks.filter(b=>list.includes(b.file)).map(b=>`<button class="tag" data-file="${esc(b.file)}" data-line="${b.line}">★ ${esc(b.file.split('/').at(-1))}:${b.line}</button>`).join('')}</div>`:'';
  $('#source-results').innerHTML=`<div class="result-info"><span>${fmt(list.length)} 个文件${srcFilter.full?' · 正在匹配文件内容':''}</span><span>当前快照 ${D.meta.head.slice(0,10)}</span></div>${bookmarkRows}<div class="source-list">${list.slice(sourcePage*40,sourcePage*40+40).map(sourceRow).join('')}</div>${list.length?'':empty('没有匹配文件。全文搜索与路径搜索可分别尝试。')}${pages('source',sourcePage,list.length,40)}`;
}
function normalize(path){const pieces=[];for(const part of path.split('/')){if(part==='..')pieces.pop();else if(part!=='.'&&part)pieces.push(part);}return pieces.join('/');}
function resolveImport(spec,file){
  if(spec.startsWith('.')){const p=normalize(file.split('/').slice(0,-1).join('/')+'/'+spec);return [p,p.replace(/\.js$/,'.ts'),p+'.ts',p+'/index.ts',p+'.tsx'].find(x=>D.files[x]!==undefined);}
  const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0]; const p=packageByName.get(name);return p?.entries[0];
}
function showFile(file,line=1,remember=true){
  if(D.files[file]===undefined){toast('该文件未内置；请在项目中查看：'+file);return;}
  if(file.endsWith('.md')){showDoc(file,remember);return;}
  const lines=D.files[file].split('\n');line=Math.max(1,Math.min(Number(line)||1,lines.length));sourceState={file,line};
  const start=Math.max(0,line-8),end=Math.min(lines.length,start+160);
  const imports=[...D.files[file].matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)].map(m=>m[1]);
  const unique=[...new Set(imports)].map(s=>[s,resolveImport(s,file)]).filter(x=>x[1]);
  const bookmarked=bookmarks.some(b=>b.file===file&&b.line===line);
  modal('源码阅读 · 当前快照',`<div class="detail-meta">${esc(file)}<br>${fmt(lines.length)} 行 · 快照 ${D.meta.head.slice(0,10)} · 历史文件请用 Git 查看当时版本</div><div class="source-toolbar"><label class="small">跳到行 <input class="input" id="line-input" type="number" min="1" max="${lines.length}" value="${line}"></label>${btn('定位','data-jump-line')}${btn(bookmarked?'★ 已收藏':'☆ 收藏此行','data-bookmark')}${btn('复制路径',`data-copy="${esc(file)}"`)}${btn('复制全文',`data-copy-file="${esc(file)}"`)}</div><div class="source-code" id="code-scroll">${lines.slice(start,end).map((s,i)=>`<span class="code-line ${i+start+1===line?'highlight':''}" id="code-line-${i+start+1}"><span class="line-no">${i+start+1}</span>${syntax(s)}</span>`).join('')}</div><div class="split spacer">${btn('← 前 150 行',`data-source-page="${Math.max(1,line-150)}" ${line<=1?'disabled':''}`)}<span class="small muted">显示 ${start+1}—${end} / ${fmt(lines.length)} 行</span>${btn('后 150 行 →',`data-source-page="${Math.min(lines.length,line+150)}" ${end>=lines.length?'disabled':''}`)}</div><div class="source-toolbar"><input class="input" style="width:250px" id="symbol-input" type="search" placeholder="在此文件定位文本 / 符号" aria-label="定位文件中的文本">${btn('查找下一处','data-find-symbol')}</div><details class="spacer"><summary class="small">沿 import 继续阅读 · ${unique.length} 个可离线跳转的导入</summary><div class="imports">${unique.map(([s,f])=>`<button class="tag" data-file="${esc(f)}">${esc(s)}</button>`).join('')}</div></details><p class="source-hint">为保持响应速度，每次呈现最多 160 行；完整文件已内置，可按行跳转或复制全文。</p>`,remember?{kind:'file',file,line}:null);
}
function inline(md,base){
  const tokens=[];let text=md.replace(/`([^`]+)`/g,(_,c)=>{tokens.push('<code>'+esc(c)+'</code>');return '\u0001'+(tokens.length-1)+'\u0001';});
  text=esc(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,label,target)=>{
    target=target.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    if(/^https?:\/\//.test(target))return `<a href="${esc(target)}" target="_blank" rel="noopener noreferrer" title="外部链接，需要联网">${label} ↗</a>`;
    if(target.startsWith('#'))return `<a href="${esc(target)}" data-doc-anchor="${esc(target.slice(1))}">${label}</a>`;
    const [path,anchor]=target.split('#');const resolved=normalize(base.split('/').slice(0,-1).join('/')+'/'+path);
    if(D.files[resolved]!==undefined)return `<a href="#" data-file="${esc(resolved)}" ${anchor?`data-anchor="${esc(anchor)}"`:''}>${label}</a>`;
    const pkg=D.packages.find(p=>p.path===resolved);if(pkg)return `<a href="#" data-package="${esc(pkg.name)}">${label}</a>`;
    return `<span title="未内置引用：${esc(resolved)}">${label} <small class="muted">[仓库引用]</small></span>`;
  }).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
  return text.replace(/\u0001(\d+)\u0001/g,(_,n)=>tokens[Number(n)]);
}
function slug(s){return plain(s).toLowerCase().trim().replace(/[^\p{L}\p{N}_ -]/gu,'').replace(/\s+/g,'-');}
function markdown(md,base){
  md=md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');const lines=md.split('\n');let out='',paragraph=[],code=[],inCode=false,lang='',list=false,table=false;
  const flush=()=>{if(paragraph.length){out+='<p>'+inline(paragraph.join(' '),base)+'</p>';paragraph=[];}};
  const closeList=()=>{if(list){out+='</ul>';list=false;}};const closeTable=()=>{if(table){out+='</tbody></table></div>';table=false;}};
  for(const line of lines){
    if(/^\s*```/.test(line)){flush();closeList();closeTable();if(inCode){out+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';code=[];}else lang=line.slice(3);inCode=!inCode;continue;}
    if(inCode){code.push(line);continue;}
    if(line.trim().startsWith('|')){flush();closeList();if(/^\s*\|[\s:|\-]+\|\s*$/.test(line))continue;const cells=line.trim().replace(/^\||\|$/g,'').split('|');if(!table){out+='<div class="table-wrap"><table><tbody>';table=true;}out+='<tr>'+cells.map(c=>'<td>'+inline(c.trim(),base)+'</td>').join('')+'</tr>';continue;}closeTable();
    if(/^\s*[-*]\s+|^\s*\d+\.\s+/.test(line)){flush();if(!list){out+='<ul>';list=true;}out+='<li>'+inline(line.replace(/^\s*(?:[-*]|\d+\.)\s+/,''),base)+'</li>';continue;}closeList();
    const heading=line.match(/^(#{1,6})\s+(.+)/);if(heading){flush();const n=heading[1].length;out+=`<h${n} id="${esc(slug(heading[2]))}">${inline(heading[2],base)}</h${n}>`;continue;}
    const anchor=line.match(/^\s*<a id="([^"]+)"[^>]*><\/a>/);if(anchor){flush();out+=`<span id="${esc(anchor[1])}"></span>`;continue;}
    if(/^\s*<details>/.test(line)){flush();out+='<details>';continue;}if(/^\s*<\/details>/.test(line)){flush();out+='</details>';continue;}
    const summary=line.match(/^\s*<summary>(.*?)<\/summary>/);if(summary){flush();out+='<summary>'+inline(summary[1],base)+'</summary>';continue;}
    if(/^\s*-{3,}\s*$/.test(line)){flush();out+='<hr>';continue;}if(/^>\s?/.test(line)){flush();out+='<blockquote>'+inline(line.replace(/^>\s?/,''),base)+'</blockquote>';continue;}
    if(!line.trim()){flush();continue;}if(line.trim().startsWith('<!--'))continue;paragraph.push(line);
  }flush();closeList();closeTable();if(inCode)out+='<pre>'+esc(code.join('\n'))+'</pre>';return out;
}
function showDoc(file,remember=true){modal('原始文档 · 内置快照',`<div class="detail-meta">${esc(file)} · ${D.meta.head.slice(0,10)}</div><div class="actions">${btn('复制文档原文',`data-copy-file="${esc(file)}"`)}</div><article class="markdown">${markdown(D.files[file],file)}</article>`,remember?{kind:'doc',file}:null);}
function renderConcepts(){
  $('#main').innerHTML=heading('BUILD A MENTAL MODEL','把概念放在正确的位置','每个概念先讲用途，再解释它与周围机制的关系。深入约定时可打开内置中文原文。')+`<div class="concept-grid">${D.guide.concepts.map((c,i)=>`<article class="concept"><div class="eyebrow">CONCEPT ${String(i+1).padStart(2,'0')}</div><h3>${esc(c.term)}</h3><p class="brief">${esc(c.brief)}</p><p>${esc(c.detail)}</p>${sourceButton(c.file,'打开对应中文文档 ↗')}</article>`).join('')}</div>`;
}
function renderCustom(){
  $('#main').innerHTML=heading('EXTEND WITHOUT LOSING THE UPSTREAM','从需求，找到二开入口','优先配置，其次插件与插槽，最后才是范围明确的源码补丁。定制越少侵入官方实现，升级越容易审查。')+`<div class="custom-grid">${D.guide.customizations.map((c,i)=>`<article class="custom-card"><div class="eyebrow">CUSTOMIZATION 0${i+1}</div><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p><div class="tags">${c.packages.map(path=>{const p=D.packages.find(p=>p.path==='packages/'+path);return p?`<button class="tag" data-package="${esc(p.name)}">${esc(p.short)}</button>`:badge(path);}).join('')}</div><div class="check"><b>如何验证</b>${esc(c.checks)}</div><div class="check"><b>维护时留意</b>${esc(c.risk)}</div>${c.doc?'<div class="spacer">'+sourceButton(c.doc,'阅读操作指南 ↗')+'</div>':''}</article>`).join('')}</div><div class="note"><b>组合建议：</b>自己的品牌、业务工具和 UI 分别组织为插件，通过自有 bundle 与 profile 加载。升级时固定基线、验证插件兼容性与关键行为，再发布已验证的版本。</div>`;
}
function renderHistory(){
  const months={};D.commits.forEach(c=>{const key=c.date.slice(0,7);months[key]=(months[key]||0)+1;});const keys=Object.keys(months).sort(),max=Math.max(...Object.values(months));
  $('#main').innerHTML=heading('THE REPOSITORY, OVER TIME','沿提交记录，读项目演进','完整收录当前 HEAD 可达的本地历史，保留原始标题、正文和变更文件。历史说明与当前行为分开阅读。',badge(fmt(D.commits.length)+' 条提交',true))+
  `<div class="note"><b>中文解说的范围：</b>${D.meta.explained} 条近期提交提供人工标题解读；其余提供基于提交类型、标题关键词与文件统计的中文自动摘要。自动摘要不是逐条 diff 审查或完整翻译，不推断标题没有说明的因果。原始记录始终可展开核对。</div>
  <div class="panel"><div class="split"><h3>提交活动</h3><span class="small muted">每柱一个月 · 点击筛选 · 按作者日期分组</span></div><div class="histogram">${keys.map(k=>`<button class="month-bar ${histFilter.month===k?'active':''}" style="height:${Math.max(5,months[k]/max*65)}px" data-month="${k}" title="${k} · ${fmt(months[k])} 条" aria-label="筛选 ${k}，${months[k]} 条提交"></button>`).join('')}</div><div class="hist-labels"><span>${keys[0]}</span><span>${keys.at(-1)}</span></div></div>
  <div class="toolbar"><input id="hist-q" class="input" type="search" placeholder="搜索中文解说、原标题、作者或提交号…" value="${esc(histFilter.q)}" aria-label="搜索提交"><select id="hist-kind" aria-label="提交类型"><option value="">所有类型</option>${Object.entries(typeNames).map(([k,v])=>`<option value="${k}" ${histFilter.kind===k?'selected':''}>${v}</option>`).join('')}</select><select id="hist-month" aria-label="提交月份"><option value="">所有月份</option>${keys.reverse().map(k=>`<option ${histFilter.month===k?'selected':''}>${k}</option>`).join('')}</select><select id="hist-order" aria-label="提交顺序"><option value="new">最新在前</option><option value="old" ${histFilter.order==='old'?'selected':''}>最早在前</option></select></div>
  <div class="toolbar"><label class="small muted">从 <input class="input" id="hist-from" style="min-width:0" type="date" value="${histFilter.from}" aria-label="开始日期"></label><label class="small muted">到 <input class="input" id="hist-to" style="min-width:0" type="date" value="${histFilter.to}" aria-label="结束日期"></label>${btn('清除筛选','data-clear-history')}<span class="small muted">日期为提交记录中的作者本地日期</span></div><div id="history-results"></div>`;
  paintHistory();
}
function historyList(){const q=histFilter.q.toLowerCase();const list=D.commits.filter(c=>(!q||(c.title+' '+c.zh+' '+c.author+' '+c.id+' '+c.scope).toLowerCase().includes(q))&&(!histFilter.kind||c.kind===histFilter.kind)&&(!histFilter.month||c.date.startsWith(histFilter.month))&&(!histFilter.from||c.date.slice(0,10)>=histFilter.from)&&(!histFilter.to||c.date.slice(0,10)<=histFilter.to));return histFilter.order==='old'?list.reverse():list;}
function paintHistory(){
  const list=historyList();historyPage=Math.min(historyPage,Math.max(0,Math.ceil(list.length/30)-1));let last='';
  const rows=list.slice(historyPage*30,historyPage*30+30).map(c=>{const day=c.date.slice(0,10);const prefix=day!==last?`<div class="date-label">${day}</div>`:'';last=day;return prefix+`<article class="commit"><button class="commit-card" data-commit="${c.id}"><div class="commit-meta"><span>${c.id.slice(0,10)}</span>${badge(typeNames[c.kind]||c.kind,c.kind==='feat')}<span>${esc(c.author)}</span><span>${c.reviewed?'人工标题解读':'自动分类摘要'}</span><span class="delta"><span class="plus">+${fmt(c.added)}</span> <span class="minus">−${fmt(c.removed)}</span></span></div><h3>${esc(c.zh)}</h3><p>${esc(c.title)}</p></button></article>`;}).join('');
  $('#history-results').innerHTML=`<div class="result-info"><span>${fmt(list.length)} 条结果 · 每页 30 条</span><span>合并统计相对第一父提交</span></div>${rows||empty('没有匹配的提交。')}${pages('history',historyPage,list.length,30)}`;
}
function showCommit(id,remember=true,filePage=0){
  const c=D.commits.find(c=>c.id===id||c.id.startsWith(id));if(!c)return;
  const first=filePage*60,changed=c.files.slice(first,first+60);
  modal('Git 提交详情',`<div class="eyebrow">${esc(typeNames[c.kind]||c.kind)} / ${esc(c.date.slice(0,10))}</div><h2 class="detail-title">${esc(c.title)}</h2><div class="detail-meta">${c.id}<br>${esc(c.author)} · ${esc(c.date)}<br>父提交：${c.parents.map(p=>`<button class="source-link" data-commit="${p}">${p.slice(0,10)}</button>`).join(' · ')||'无（根提交）'}</div><div class="note"><b>${c.reviewed?'人工标题解读':'中文自动分类摘要'}：</b>${esc(c.zh)}</div><div class="actions">${btn('复制提交号',`data-copy="${c.id}"`)}${btn('复制本地查看差异命令',`data-copy="git show ${c.id}${c.parents.length>1?' --diff-merges=first-parent':''}"`)}</div>${c.body?`<h3 class="spacer">原始提交正文</h3><pre class="source-code" style="padding:16px;white-space:pre-wrap">${esc(c.body)}</pre>`:''}<div class="section-head"><h3>变更文件 · ${fmt(c.files.length)}</h3><span class="small"><span class="plus">+${fmt(c.added)}</span> <span class="minus">−${fmt(c.removed)}</span></span></div><p class="source-hint">文件清单来自此提交的 numstat。链接打开的是本文档当前快照，不是历史版本。完整历史 diff 未内置，可复制上方命令在仓库查看；二进制统计显示为「—」。</p>${changed.map(([f,a,d])=>`<div class="file-detail">${D.files[f]!==undefined?`<button data-file="${esc(f)}">${esc(f)} ↗</button>`:`<span style="flex:1;overflow-wrap:anywhere;white-space:normal">${esc(f)}</span>`}<span class="plus">${a===null?'—':'+'+a}</span><span class="minus">${d===null?'—':'−'+d}</span></div>`).join('')||'<p class="small muted">没有 numstat 文件条目。</p>'}${c.files.length>60?`<div class="pagination">${btn('上一组',`data-commit-files="${Math.max(0,filePage-1)}" data-id="${c.id}" ${filePage===0?'disabled':''}`)}<span>${first+1}—${Math.min(first+60,c.files.length)}</span>${btn('下一组',`data-commit-files="${filePage+1}" data-id="${c.id}" ${first+60>=c.files.length?'disabled':''}`)}</div>`:''}`,remember?{kind:'commit',id:c.id}:null);
}
function renderAbout(){
  const m=D.meta;
  $('#main').innerHTML=heading('SNAPSHOT & MAINTENANCE','知道你正在读哪个版本','本文件是可复现的离线阅读快照。包说明与源码来自生成时的工作树，提交索引来自同一仓库的 HEAD。')+
  (m.guideNeedsReview?'<div class="note"><b>流程说明待复核：</b>源码 HEAD 已超出 guide.json 中的人工核实基线。锚点检查通过不表示解释已经适配新语义。</div>':'')+
  `<div class="coverage-grid"><section class="panel"><h3>当前基线</h3><dl class="metric-list"><dt>项目版本</dt><dd>${esc(m.version)}</dd><dt>HEAD</dt><dd class="mono">${m.head}</dd><dt>生成时间</dt><dd>${esc(m.generated)}</dd><dt>项目包</dt><dd>${m.packageCount} 个，全部有中文 README</dd><dt>内置文件</dt><dd>${fmt(m.fileCount)} 个</dd><dt>Git 历史</dt><dd>${fmt(m.commitCount)} 条 · ${m.shallow?'浅克隆，仅本地可用部分':'非浅克隆'}</dd><dt>受跟踪改动</dt><dd>${m.dirty?esc(m.dirty):'生成时未检测到受跟踪文件改动'}</dd></dl></section>
  <section class="panel"><h3>覆盖范围与阅读证据</h3><ul><li>全部 packages/*/* 包的 manifest、中文 README 和收录源码。</li><li>CLI、应用源码及 docs 文档随快照内置；基础库和插件分开标注。</li><li>四条运行路线为人工整理，源码锚点由生成器定位并检查。</li><li>Git 时间线含 ${m.explained} 条人工标题解读，其余是自动分类摘要，不替代差异审查。</li><li>未内置完整历史 diff、vendor 源码、依赖目录、密钥和运行数据。</li><li>静态依赖只表示 manifest 声明；不声称是自动推导的完整运行时调用图。</li></ul></section>
  <section class="panel"><h3>随源码更新</h3><p>在项目根目录执行：</p><pre class="source-code" style="padding:15px">python qishu/doc-html/build.py</pre><p>生成器重新采集包、文档、源码和全部可达提交，并更新 index.html 与 manifest.json。无需在线 API。</p><p>如果流程锚点消失，生成会失败，需要复核 guide.json 的说明与定位。锚点仍在不代表语义未变；升级后仍需审阅相关流程。</p><p>history-zh.json 可补充按提交号索引的中文解读。manifest.json 保存文件摘要，便于比较两次快照。</p></section>
  <section class="panel"><h3>离线与交互</h3><ul><li>双击 index.html；单独复制这个文件也能阅读。</li><li>推荐现代 Edge / Chrome / Firefox，需支持 DecompressionStream 解压内置资料。</li><li>没有 CDN、外部字体、网络请求或在线模型依赖。</li><li>Ctrl / ⌘ + K 全站搜索；Esc 关闭详情。</li><li>书签、已读进度与主题保存在当前浏览器；文件存储受限时阅读仍可用。</li><li>跟随系统的减少动画偏好，也可使用侧栏手动关闭过渡。</li></ul></section></div>
  <div class="section-head"><h2>快速打开基础资料</h2></div><div class="actions">${['docs/architecture.zh.md','docs/cordis-primer.zh.md','docs/development.zh.md','docs/testing.zh.md'].map(f=>btn(f.split('/').pop(),`data-file="${f}"`)).join('')}</div><div class="note">文档中的远程链接标记为 ↗，需要联网才可访问；缺少内置目标的引用显示为「仓库引用」。学习主线、包说明、源码阅读和提交索引本身均可离线使用。</div><details class="panel"><summary>内置项目源码与文档的 MIT 许可证</summary><pre class="small" style="white-space:pre-wrap">${esc(D.license||'')}</pre></details>`;
}
let diagramURL;
function showDiagram(){
  if(!diagramURL)diagramURL=URL.createObjectURL(new Blob([D.diagram],{type:'text/html'}));
  modal('可交互运行总图',`<p class="source-hint">一条路径展示一个执行步骤；条件、循环和错误分支的详细解释请结合阅读路线。总图支持主题、追踪动画和导出。</p><div class="actions spacer"><a class="btn" href="${diagramURL}" target="_blank" rel="noopener">在独立窗口打开 ↗</a></div><iframe class="diagram-frame spacer" title="一轮对话的执行与记录" src="${diagramURL}"></iframe>`,{kind:'diagram'});
}
function route(){
  if(typeof matrixPause==='function')matrixPause();
  clearInterval(timer);timer=null;
  const [page,target]=location.hash.slice(1).split('/');currentPage=navs.some(x=>x[0]===page)?page:'overview';
  if(currentPage==='flows'&&target){const flow=decodeURIComponent(target);if(flow!==activeFlow){activeFlow=flow;activeStep=0;}}
  $('#crumb').textContent=navs.find(x=>x[0]===currentPage)[1];document.title=navs.find(x=>x[0]===currentPage)[1]+' · 栖树源码导览';
  document.querySelectorAll('.nav-item').forEach(x=>{x.classList.toggle('active',x.dataset.nav===currentPage);x.setAttribute('aria-current',x.dataset.nav===currentPage?'page':'false');});
  ({overview:renderOverview,matrix:renderMatrix,features:renderFeatures,flows:renderFlows,packages:renderPackages,source:renderSource,concepts:renderConcepts,custom:renderCustom,history:renderHistory,about:renderAbout})[currentPage]();
  $('#main').classList.remove('enter');void $('#main').offsetWidth;$('#main').classList.add('enter');$('#sidebar').classList.remove('open');window.scrollTo({top:0});
}
function showSearch(){ $('#search-dialog').showModal();$('#omni').focus();if(!$('#omni').value)$('#search-results').innerHTML='<p class="small muted">试试「会话」「品牌」或「agent-loop」。搜索完全在本地执行。</p>'; }
function omniSearch(q){
  q=q.trim().toLowerCase();if(!q){$('#search-results').innerHTML='';return;}
  const pkgs=D.packages.filter(p=>(p.name+' '+p.summary).toLowerCase().includes(q)).slice(0,5);
  const fs=filePaths.filter(f=>f.toLowerCase().includes(q)).slice(0,7);
  const cs=D.commits.filter(c=>(c.title+' '+c.zh+' '+c.id).toLowerCase().includes(q)).slice(0,5);
  $('#search-results').innerHTML=(pkgs.length?'<div class="search-group">插件与包</div>'+pkgs.map(p=>`<button class="search-result" data-package="${esc(p.name)}">${esc(p.short)}<small>${esc(plain(p.summary).slice(0,100))}</small></button>`).join(''):'')+(fs.length?'<div class="search-group">源码与文档</div>'+fs.map(f=>`<button class="search-result" data-file="${esc(f)}">${esc(f)}</button>`).join(''):'')+(cs.length?'<div class="search-group">提交记录</div>'+cs.map(c=>`<button class="search-result" data-commit="${c.id}">${esc(c.zh.slice(0,120))}<small>${c.id.slice(0,10)} · ${esc(c.title)}</small></button>`).join(''):'')+(!pkgs.length&&!fs.length&&!cs.length?empty('没有匹配结果。试试包名或更短的关键词。'):'');
}
function setTheme(theme){document.documentElement.dataset.theme=theme;save('theme',theme);$('#theme').textContent=theme==='light'?'◐ 切换深色':'◑ 切换浅色';}
function setMotion(off){document.documentElement.dataset.motion=off?'off':'on';save('motion',off);$('#motion').setAttribute('aria-pressed',String(off));$('#motion').textContent=off?'◌ 恢复动画':'◌ 减少动画';}
function backModal(){dialogStack.pop();const r=dialogStack.at(-1);if(!r){$('#detail').close();return;}if(r.kind==='package')showPackage(r.name,r.tab,false);if(r.kind==='file')showFile(r.file,r.line,false);if(r.kind==='doc')showDoc(r.file,false);if(r.kind==='commit')showCommit(r.id,false);if(r.kind==='diagram'){dialogStack.pop();showDiagram();}}
function bind(){
  window.addEventListener('hashchange',route);$('#detail').addEventListener('close',()=>{dialogStack=[];$('#main').focus({preventScroll:true});});
  $('#search-open').onclick=showSearch;$('#theme').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
  $('#motion').onclick=()=>setMotion(document.documentElement.dataset.motion!=='off');$('#menu').onclick=()=>$('#sidebar').classList.toggle('open');
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();showSearch();}if(e.key==='Escape'){const dialog=$('#search-dialog').open?$('#search-dialog'):$('#detail').open?$('#detail'):null;if(dialog){e.preventDefault();dialog.close();}}});
  for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  document.addEventListener('click',e=>{
    const b=e.target.closest('button,a');if(!b)return;const d=b.dataset;
    if(d.close){$('#'+d.close).close();return;}
    if(d.nav){e.preventDefault();goto(d.nav,d.target||'');return;}
    if(d.group!==undefined){pkgFilter.group=d.group;packagePage=0;goto('packages');return;}
    if(d.package||d.file||d.commit){e.preventDefault();if($('#search-dialog').open)$('#search-dialog').close();if(d.package)showPackage(d.package);if(d.file){showFile(d.file,d.line||1);if(d.anchor)setTimeout(()=>scrollDocAnchor(d.anchor),0);}if(d.commit)showCommit(d.commit);return;}
    if(d.modalBack!==undefined){backModal();return;}
    if(d.docAnchor){e.preventDefault();scrollDocAnchor(d.docAnchor);return;}
    if(d.copy!==undefined){copy(d.copy);return;}if(d.copyFile){copy(D.files[d.copyFile]);return;}
    if(d.flow){activeFlow=d.flow;activeStep=0;goto('flows',activeFlow);return;}
    if(d.step!==undefined){clearInterval(timer);timer=null;activeStep=Number(d.step);renderFlows();return;}
    if(d.play!==undefined){if(timer){clearInterval(timer);timer=null;}else{const steps=D.guide.flows.find(f=>f.id===activeFlow).steps;if(activeStep===steps.length-1)activeStep=0;timer=setInterval(()=>{if(activeStep<steps.length-1)activeStep++;else{clearInterval(timer);timer=null;toast('本条路线演示完成');}renderFlows();},4500);}renderFlows();return;}
    if(d.nextFlow!==undefined){const i=D.guide.flows.findIndex(f=>f.id===activeFlow);activeFlow=D.guide.flows[(i+1)%D.guide.flows.length].id;activeStep=0;goto('flows',activeFlow);return;}
    if(d.read!==undefined){const key=activeFlow+':'+activeStep;seen=seen.includes(key)?seen.filter(x=>x!==key):[...seen,key];save('seen',seen);renderFlows();return;}
    if(d.diagram!==undefined){showDiagram();return;}
    if(d.pkgGroup!==undefined){pkgFilter.group=d.pkgGroup;packagePage=0;renderPackages();return;}
    if(d.pkgTab){if(dialogStack.at(-1)?.kind==='package')dialogStack.at(-1).tab=d.pkgTab;showPackage(d.name,d.pkgTab,false);return;}
    if(d.pageKind){const n=Number(d.index);if(d.pageKind==='packages'){packagePage=n;paintPackages();}if(d.pageKind==='source'){sourcePage=n;paintSource();}if(d.pageKind==='history'){historyPage=n;paintHistory();}window.scrollTo({top:Math.max(0,$('#main').offsetTop),behavior:document.documentElement.dataset.motion==='off'?'instant':'smooth'});return;}
    if(d.jumpLine!==undefined){showFile(sourceState.file,$('#line-input').value,false);return;}
    if(d.sourcePage){showFile(sourceState.file,d.sourcePage,false);return;}
    if(d.findSymbol!==undefined){const q=$('#symbol-input').value;if(!q)return;const lines=D.files[sourceState.file].split('\n');let n=lines.findIndex((l,i)=>i>=sourceState.line&&l.includes(q));if(n<0)n=lines.findIndex(l=>l.includes(q));if(n<0)toast('此文件未找到该文本');else{showFile(sourceState.file,n+1,false);$('#symbol-input').value=q;}return;}
    if(d.bookmark!==undefined){const {file,line}=sourceState;const exists=bookmarks.some(x=>x.file===file&&x.line===line);bookmarks=exists?bookmarks.filter(x=>x.file!==file||x.line!==line):[...bookmarks,{file,line}];save('bookmarks',bookmarks);showFile(file,line,false);toast(exists?'已移除书签':'已收藏此行');return;}
    if(d.month){histFilter.month=histFilter.month===d.month?'':d.month;historyPage=0;renderHistory();return;}
    if(d.clearHistory!==undefined){histFilter={q:'',kind:'',month:'',order:'new',from:'',to:''};historyPage=0;renderHistory();return;}
    if(d.commitFiles!==undefined){showCommit(d.id,false,Number(d.commitFiles));return;}
  });
  let debounce;
  document.addEventListener('input',e=>{const id=e.target.id,v=e.target.value;clearTimeout(debounce);if(id==='omni')debounce=setTimeout(()=>omniSearch(v),130);if(id==='pkg-q'){pkgFilter.q=v;packagePage=0;debounce=setTimeout(paintPackages,130);}if(id==='src-q'){srcFilter.q=v;sourcePage=0;debounce=setTimeout(paintSource,220);}if(id==='hist-q'){histFilter.q=v;historyPage=0;debounce=setTimeout(paintHistory,170);}});
  document.addEventListener('change',e=>{const id=e.target.id,v=e.target.value;if(id==='pkg-group'){pkgFilter.group=v;packagePage=0;renderPackages();}if(id==='pkg-role'){pkgFilter.role=v;packagePage=0;paintPackages();}if(id==='src-type'){srcFilter.type=v;sourcePage=0;paintSource();}if(id==='src-full'){srcFilter.full=e.target.checked;sourcePage=0;paintSource();}if(id.startsWith('hist-')&&id!=='hist-q'){histFilter[id.slice(5)]=v;historyPage=0;paintHistory();}});
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='line-input'){showFile(sourceState.file,e.target.value,false);}if(e.key==='Enter'&&e.target.id==='symbol-input')$('[data-find-symbol]').click();});
}
function scrollDocAnchor(anchor){let target;try{target=$('#detail-content').querySelector('#'+CSS.escape(decodeURIComponent(anchor)));}catch(_error){return;}if(target){for(let p=target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;target.scrollIntoView({block:'start'});}else toast('此文档中未找到该小节');}
async function boot(){
  try{
    if(!('DecompressionStream' in window))throw new Error('此浏览器不支持内置解压，请使用现代 Edge、Chrome 或 Firefox 打开。');
    const binary=atob($('#packed').textContent.trim());const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    $('#load-state').textContent='解压源码、中文文档与提交索引…';
    const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();D=JSON.parse(text);$('#packed').remove();
    D.commits.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
    packageByName=new Map(D.packages.map(p=>[p.name,p]));filePaths=Object.keys(D.files).sort();seen=saved('seen',[]);bookmarks=saved('bookmarks',[]);
    $('#version').textContent='v'+D.meta.version;$('#baseline').textContent='HEAD '+D.meta.head.slice(0,10);$('#footer-meta').textContent='离线快照 / '+D.meta.head.slice(0,10);
    $('#nav').innerHTML='<div class="nav-group">理解项目</div>'+navs.map(([id,t,ic],i)=>(i===3?'<div class="nav-group">深入探索</div>':'')+`<a href="#${id}" class="nav-item" data-nav="${id}"><span class="nav-icon">${ic}</span>${t}<span class="nav-no">0${i+1}</span></a>`).join('');
    setTheme(saved('theme','light'));setMotion(saved('motion',matchMedia('(prefers-reduced-motion: reduce)').matches));bind();$('#loading').hidden=true;$('#shell').hidden=false;route();window.atlasReady=true;
  }catch(error){$('#load-state').textContent='加载失败：'+error.message;$('.loading-track').hidden=true;console.error(error);}
}
boot();
