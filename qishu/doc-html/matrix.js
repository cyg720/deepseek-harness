/* The learning graph uses package declarations and documented relationships.
 * Projection coordinates are teaching layout, never inferred execution order.
 */
const MX = { view:'map', mode:'spatial', area:'all', relation:'dependency', selected:'@deepseek-ai/dsh-agent-loop', query:'', nodePage:0, matrixPage:0, neighbors:false, yaw:-18, tilt:48, zoom:1, scene:'chat', step:0, profile:'web', compare:'desktop', rowFilter:'all', profileQuery:'', cell:null, playing:null, replayIndex:0, replay:null, error:'', initialized:false };
const mxKinds={dependency:'包依赖',service:'服务协作',event:'事件关系'};
const mxTabs=[['map','空间组态','01'],['relations','关系矩阵','02'],['profiles','启动对比','03'],['flow','场景流转','04'],['replay','记录回放','05']];
let matrixLearned=[];
function matrixPause(){if(MX.playing){clearInterval(MX.playing);MX.playing=null;}}
function mxArea(name){return D.matrix.areas.find(a=>a.packages.includes(name));}
function mxPkg(name){return packageByName.get(name);}
function mxAction(label,action,value='',cls='btn'){return `<button class="${cls}" data-mx="${action}" data-value="${esc(value)}">${label}</button>`;}
function mxSelect(id,options,value){return `<select id="${id}" aria-label="${id==='mx-relation'?'关系类型':id==='mx-area'?'子系统分区':id.includes('profile')?'对比的应用组合':'选择筛选条件'}">${options.map(([v,t])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(t)}</option>`).join('')}</select>`;}
function mxOptions(){return [['all','全部子系统'],...D.matrix.areas.map(a=>[a.id,a.title+' · '+a.packages.length])];}
function mxSource(file,line=1,text='查看源码依据 ↗'){return sourceButton(file,text,line);}
function mxVisibleEdges(){return D.matrix.edges.filter(e=>e.kind===MX.relation);}
function mxNeighbors(name){return new Set(mxVisibleEdges().filter(e=>e.source===name||e.target===name).flatMap(e=>[e.source,e.target]));}
function mxMatches(p,q){
  if(!q)return true;
  if((p.name+' '+p.summary+' '+p.path).toLowerCase().includes(q))return true;
  return D.matrix.services.some(s=>s.name.toLowerCase().includes(q)&&[...s.definition,...s.providers,...s.consumers].includes(p.name))||D.matrix.events.some(e=>e.name.toLowerCase().includes(q)&&[...e.dispatchers,...e.listeners].includes(p.name));
}
function mxPackages(){const area=D.matrix.areas.find(a=>a.id===MX.area),q=MX.query.trim().toLowerCase(),near=MX.neighbors?mxNeighbors(MX.selected):null;return D.packages.filter(p=>(!area||area.packages.includes(p.name))&&(!near||near.has(p.name))&&mxMatches(p,q));}
function renderMatrix(){
  if(!MX.initialized){matrixLearned=saved('matrix-learned',[]);bindMatrix();MX.initialized=true;}
  $('#main').innerHTML=heading('VISUAL LEARNING LAB · OFFLINE','可视矩阵 · 看懂插件如何协作','从空间分区认识全局，用矩阵核对关系，再跟着一个具体场景逐步走进源码。',`<span class="mx-badge">${D.packages.length} PACKAGES / LOCAL</span>`)+
    `<div class="mx-tabs" role="tablist" aria-label="可视矩阵视图">${mxTabs.map(([id,title,n])=>`<button class="mx-tab ${MX.view===id?'active':''}" data-mx="view" data-value="${id}" role="tab" aria-selected="${MX.view===id}"><small>${n}</small>${title}</button>`).join('')}</div>
    <div class="mx-coach"><span class="mx-coach-icon">◎</span><div><strong>第一次来？</strong> 先展开「智能体与模型」，点 agent-loop；再进入「场景流转」播放一句话如何得到回答。<br>空间位置只代表学习分组；包、插件实例、服务与事件分别标注。</div>${mxAction('带我开始 →','begin')}</div>
    ${D.meta.head!==D.matrix.reviewedHead?'<div class="mx-warning">当前源码已超出矩阵讲解的核实版本，场景解释需要复核。静态锚点仍在不代表语义不变。</div>':''}
    <div id="mx-content" class="enter"></div>
    <div class="mx-tools-row"><span class="small muted">基线 ${D.meta.head.slice(0,10)} · 无网络 · 教学动画不代表真实执行监控</span><div class="actions">${mxAction('导出学习进度','export-progress')}${mxAction('导入进度','import-progress')}</div></div><input class="mx-file-input" id="mx-progress-file" type="file" accept=".json" aria-label="导入学习进度">`;
  paintMatrixView();
}
function paintMatrixView(){const el=$('#mx-content');if(!el)return;({map:mxMap,relations:mxRelations,profiles:mxProfiles,flow:mxFlow,replay:mxReplay})[MX.view]();}
function mxView(view){matrixPause();MX.view=view;renderMatrix();}
function mxFilters(){return `<div class="mx-search-area"><input class="input" id="mx-search" type="search" value="${esc(MX.query)}" placeholder="搜索包、中文职责、ctx 服务或事件…" aria-label="搜索矩阵中的包与服务">${mxSelect('mx-area',mxOptions(),MX.area)}${mxSelect('mx-relation',Object.entries(mxKinds),MX.relation)}</div>`;}
function mxMap(){
  $('#mx-content').innerHTML=mxFilters()+`<div class="mx-workspace"><div><div class="mx-canvas-panel"><div class="mx-canvas-header"><div><h3 id="mx-map-title">${MX.area==='all'&&!MX.query&&!MX.neighbors?'项目空间总览':esc(D.matrix.areas.find(a=>a.id===MX.area)?.title||'检索结果')}</h3><small>2.5D TOPOLOGY · 分区内点击节点查看依据</small></div><div class="mx-segment">${mxAction('空间','mode','spatial',MX.mode==='spatial'?'active':'')}${mxAction('平面','mode','flat',MX.mode==='flat'?'active':'')}</div></div><div class="mx-stage" id="mx-stage"><svg id="mx-map-svg" role="img" aria-label="可旋转的项目插件分区图"></svg></div><div class="mx-camera"><label>旋转 <input type="range" id="mx-yaw" min="-45" max="45" value="${MX.yaw}" aria-label="旋转组态"></label><label>倾斜 <input type="range" id="mx-tilt" min="15" max="65" value="${MX.tilt}" aria-label="倾斜组态"></label>${mxAction('−','zoom','out')}${mxAction('+','zoom','in')}${mxAction('复位','reset-camera')}<span class="mx-spacer">拖动空白处旋转</span></div><div class="mx-legend"><span><i></i> 包依赖：使用方 → 被依赖包</span><span><i class="amber"></i> 服务：使用方 / 提供者 → 定义包</span><span><i class="violet"></i> 事件：派发方 → 监听方</span></div></div>
    <div class="mx-relative-tools">${mxAction(MX.neighbors?'✓ 仅看选中包的直接关系':'仅看选中包的直接关系','neighbors','',MX.neighbors?'active':'')}${mxAction('返回全部分区','areas')}<span class="small muted">线只显示选中包的直接关系；空白不证明运行时无联系。</span></div><div id="mx-map-pager"></div><div id="mx-search-results"></div></div><aside class="mx-inspector" id="mx-inspector"></aside></div>`;
  drawMxMap();mxInspector();
}
function mxMapItems(){
  if(MX.area==='all'&&!MX.query&&!MX.neighbors)return D.matrix.areas.map((a,i)=>({id:a.id,area:true,label:a.title,sub:a.subtitle,count:a.packages.length,color:a.color,index:i}));
  let list=mxPackages();if(MX.neighbors&&MX.selected){list.sort((a,b)=>a.name===MX.selected?-1:b.name===MX.selected?1:0);}
  MX.nodePage=Math.min(MX.nodePage,Math.max(0,Math.ceil(list.length/20)-1));
  return list.slice(MX.nodePage*20,MX.nodePage*20+20).map((p,i)=>({id:p.name,area:false,label:p.short,sub:p.role,count:p.deps.filter(x=>packageByName.has(x)).length,color:mxArea(p.name)?.color||'#9cbaaa',index:i}));
}
function drawMxMap(){
  const svg=$('#mx-map-svg');if(!svg)return;
  const items=mxMapItems(),overview=items[0]?.area,cols=overview?3:4;
  const yaw=MX.mode==='flat'?0:MX.yaw*Math.PI/180,tilt=MX.mode==='flat'?0:MX.tilt*Math.PI/180;
  const project=(x,y,z)=>[x*Math.cos(yaw)-y*Math.sin(yaw),(x*Math.sin(yaw)+y*Math.cos(yaw))*Math.cos(tilt)-z*Math.sin(tilt)];
  const points=items.map((item,i)=>{
    const x=(i%cols)*220,y=Math.floor(i/cols)*155,z=MX.mode==='flat'?0:(overview?[42,10,65,24,6,37,0,28,14][i]:14);
    const top=[[-96,-52],[96,-52],[96,52],[-96,52]].map(([a,b])=>project(x+a,y+b,z));
    const bottom=[[-96,-52],[96,-52],[96,52],[-96,52]].map(([a,b])=>project(x+a,y+b,z-16));
    return {...item,x,y,z,top,bottom,center:project(x,y,z)};
  });
  const all=points.flatMap(p=>[...p.top,...p.bottom]);
  if(!all.length){svg.setAttribute('viewBox','0 0 700 300');svg.innerHTML='<text x="350" y="150" fill="#a6c2b4" text-anchor="middle">没有匹配节点，请调整搜索或分区。</text>';$('#mx-map-pager').innerHTML='';$('#mx-search-results').innerHTML='';return;}
  const minX=Math.min(...all.map(p=>p[0]))-38,maxX=Math.max(...all.map(p=>p[0]))+38,minY=Math.min(...all.map(p=>p[1]))-60,maxY=Math.max(...all.map(p=>p[1]))+60;
  const w=(maxX-minX)/MX.zoom,h=(maxY-minY)/MX.zoom;svg.setAttribute('viewBox',`${(minX+maxX-w)/2} ${(minY+maxY-h)/2} ${w} ${h}`);
  const pair=pts=>pts.map(p=>p.map(n=>n.toFixed(2)).join(',')).join(' ');
  const nodeByName=new Map(points.map(p=>[p.id,p]));
  const edgeKeys=new Set();let edgeHTML='';
  if(!overview)for(const edge of mxVisibleEdges()){
    if(edge.source!==MX.selected&&edge.target!==MX.selected)continue;
    const a=nodeByName.get(edge.source),b=nodeByName.get(edge.target),key=edge.source+'>'+edge.target;if(!a||!b||edgeKeys.has(key))continue;edgeKeys.add(key);
    const [ax,ay]=a.center,[bx,by]=b.center,dx=bx-ax,dy=by-ay;
    const dist=Math.hypot(dx,dy)||1,offset=Math.min(dist*.34,65),sx=ax+dx/dist*offset,sy=ay+dy/dist*offset,tx=bx-dx/dist*offset,ty=by-dy/dist*offset;
    edgeHTML+=`<path class="mx-graph-edge ${edge.kind}" d="M ${sx} ${sy} L ${tx} ${ty}" marker-end="url(#mx-arrow)"><title>${esc(mxPkg(edge.source).short+' → '+mxPkg(edge.target).short+' · '+edge.label)}</title></path>`;
  }
  svg.innerHTML=`<defs><marker id="mx-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#a6c4b3"/></marker></defs>${edgeHTML}`+points.sort((a,b)=>a.center[1]-b.center[1]).map(p=>{
    const [cx,cy]=p.center,label=p.label.length>25?p.label.slice(0,23)+'…':p.label,chosen=p.area?mxArea(MX.selected)?.id===p.id:MX.selected===p.id;
    return `<g class="mx-node ${chosen?'selected':''}" data-mx-node="${esc(p.id)}" data-area-node="${p.area}" tabindex="0" role="button" aria-label="${esc(p.label)}${p.area?'，展开 '+p.count+' 个包':''}"><title>${esc(p.label+' · '+p.sub)}</title><polygon points="${pair([p.top[1],p.top[2],p.bottom[2],p.bottom[1]])}" fill="#173739" stroke="#436059"/><polygon points="${pair([p.top[2],p.top[3],p.bottom[3],p.bottom[2]])}" fill="#163234" stroke="#35584e"/><polygon class="mx-top" points="${pair(p.top)}" fill="${p.color}20" stroke="${p.color}70"/><text class="${p.area?'mx-label':'mx-node-label-path'}" x="${cx}" y="${cy-6}" text-anchor="middle">${esc(label)}</text><text class="mx-sublabel" x="${cx}" y="${cy+12}" text-anchor="middle">${esc(p.sub)}</text><text class="mx-count" x="${cx}" y="${cy+29}" text-anchor="middle">${p.count} ${p.area?'PACKAGES':'DIRECT DEPS'}</text></g>`;
  }).join('');
  const list=mxPackages();$('#mx-map-pager').innerHTML=overview?'':`<div class="pagination">${mxAction('← 上一组','node-page',Math.max(0,MX.nodePage-1))}<span>${MX.nodePage+1} / ${Math.max(1,Math.ceil(list.length/20))} · ${list.length} 个包</span>${mxAction('下一组 →','node-page',Math.min(Math.max(0,Math.ceil(list.length/20)-1),MX.nodePage+1))}</div>`;
  $('#mx-search-results').innerHTML=MX.query?`<div class="mx-help">${list.length} 个搜索结果；图中每次最多展示 20 个，其余可翻页。</div><div class="mx-results">${list.slice(MX.nodePage*20,MX.nodePage*20+20).map(p=>`<button class="mx-result" data-mx="select-package" data-value="${esc(p.name)}">${esc(p.short)}<small>${esc(plain(p.summary).slice(0,90))}</small></button>`).join('')}</div>`:'';
}
function mxInspector(){
  const el=$('#mx-inspector');if(!el)return;const p=mxPkg(MX.selected);if(!p){el.innerHTML='<h2>先选择一个节点</h2><p>分区帮你建立全局印象；展开后再查看具体包、服务与事件。</p>';return;}
  const services=D.matrix.services.filter(s=>[...s.definition,...s.providers,...s.consumers].includes(p.name));
  const events=D.matrix.events.filter(e=>[...e.dispatchers,...e.listeners].includes(p.name));
  const outgoing=mxVisibleEdges().filter(e=>e.source===p.name),incoming=mxVisibleEdges().filter(e=>e.target===p.name);
  const bundles=D.matrix.bundles.filter(b=>b.rows.some(r=>r.package===p.name));
  el.innerHTML=`<div class="eyebrow">NODE INSPECTOR / ${esc(mxArea(p.name)?.title||p.group)}</div><h2>${esc(p.short)}</h2>${badge(p.role,true)} ${badge(p.group==='experimental'?'实验区域':'项目包')}<p class="spacer">${esc(plain(p.summary))}</p><div class="mx-microstats"><div>${outgoing.length}<small>指向其他包</small></div><div>${incoming.length}<small>其他包指向它</small></div><div>${services.length}<small>关联服务</small></div></div><div class="actions">${btn('中文完整说明',`data-package="${esc(p.name)}"`)}${p.entries[0]?btn('源码入口 ↗',`data-file="${esc(p.entries[0])}"`):''}${mxAction('在关系矩阵定位','locate-matrix')}</div>
    <h3>服务：定义、实现和使用</h3>${services.length?services.map(s=>`<div class="mx-fact"><strong>${esc(s.name)}</strong><small>${s.definition.includes(p.name)?'定义 / 服务拥有者':s.providers.includes(p.name)?'提供实现':'服务使用方'} · 目录证据</small>${mxSource(s.file,s.line,'查看服务目录 ↗')}</div>`).join(''):'<p>服务目录没有记录此包的角色；不据此断言它没有动态服务关系。</p>'}
    <details class="spacer"><summary class="small">事件派发与监听 · ${events.length}</summary>${events.map(e=>`<div class="mx-fact"><strong>${esc(e.name)}</strong><small>${e.dispatchers.includes(p.name)?'派发':''}${e.dispatchers.includes(p.name)&&e.listeners.includes(p.name)?' / ':''}${e.listeners.includes(p.name)?'监听':''} · ${esc(e.mode)}</small>${mxSource(e.file,e.line,'查看事件矩阵 ↗')}</div>`).join('')||'<p>生成的事件目录未记录此包。</p>'}</details>
    <h3>在哪些 bundle 中被引用</h3>${bundles.length?bundles.map(b=>`<div class="mx-fact"><strong>${esc(b.name.replace('@deepseek-ai/dsh-',''))}</strong><small>${b.rows.filter(r=>r.package===p.name).length} 条配置引用；包含可能延迟选择的预设条目</small>${mxSource(b.files[0],1,'查看组合配置 ↗')}</div>`).join(''):'<p>已扫描的 bundle 没有命名引用，仍可能作为库依赖或外部配置加载。</p>'}<p class="mx-help">包是发布单位，插件实例是配置中的一次挂载。这里不把源码包自动当成已激活实例；配置项、工具和 UI 扩展见完整中文说明。</p>`;
}
function mxRelations(){
  const list=mxPackages(),pinned=MX.neighbors?mxPkg(MX.selected):null,size=pinned?21:22,others=pinned?list.filter(p=>p.name!==pinned.name):list;MX.matrixPage=Math.min(MX.matrixPage,Math.max(0,Math.ceil(others.length/size)-1));const visible=[...(pinned?[pinned]:[]),...others.slice(MX.matrixPage*size,MX.matrixPage*size+size)],index=new Map();
  for(const e of mxVisibleEdges()){const key=e.source+'>'+e.target;if(!index.has(key))index.set(key,[]);index.get(key).push(e);}
  const description=MX.relation==='dependency'?'行使用方 → 列被依赖包。来自 dependencies 与 peerDependencies。':MX.relation==='service'?'行提供者或消费者 → 列服务定义包。单元格可展开具体服务名与角色。':'行派发方 → 列监听方。关系表示目录中存在对应角色，并不保证每次事件都到达该监听者。';
  $('#mx-content').innerHTML=mxFilters()+`<div class="mx-warning"><b>怎样读矩阵：</b>${description} 数字是关系记录条数；「·」是未记录直接关系，不是断言两者永不协作。</div><div class="result-info"><span>${list.length} 个包 · 每页同一组最多 ${size+(pinned?1:0)} 行 / 列</span><span>${mxVisibleEdges().length} 条全量关系记录</span></div><div class="mx-table-wrap"><table class="mx-table"><thead><tr><th>行 → 列<br>${esc(mxKinds[MX.relation])}</th>${visible.map(p=>`<th title="${esc(p.name)}"><span>${esc(p.short)}</span></th>`).join('')}</tr></thead><tbody>${visible.map(p=>`<tr><th title="${esc(p.name)}"><button data-mx="select-from-matrix" data-value="${esc(p.name)}">${esc(p.short)}</button></th>${visible.map(t=>{const edges=index.get(p.name+'>'+t.name)||[];return `<td>${edges.length?`<button class="mx-cell ${MX.relation}" data-mx="cell" data-source="${esc(p.name)}" data-target="${esc(t.name)}" aria-label="${esc(p.short+' → '+t.short+'，'+edges.length+' 条关系')}" title="${esc(edges.map(e=>e.label).join('\n'))}">${edges.length}</button>`:`<span class="mx-zero">${p===t?'—':'·'}</span>`}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div>${visible.length?'':empty('该筛选下没有节点。')}<div class="pagination">${mxAction('← 上一页','matrix-page',Math.max(0,MX.matrixPage-1))}<span>${MX.matrixPage+1} / ${Math.max(1,Math.ceil(others.length/size))}</span>${mxAction('下一页 →','matrix-page',Math.min(Math.max(0,Math.ceil(others.length/size)-1),MX.matrixPage+1))}</div><p class="mx-help">跨页关系：点击行标题定位包，再点「在关系矩阵定位」。此时该包固定在每一页，翻页即可核对它的全部直接关系。</p><div id="mx-cell-proof"></div>`;
  mxCellProof();
}
function mxCellProof(){const el=$('#mx-cell-proof');if(!el)return;if(!MX.cell){el.innerHTML='<div class="mx-proof"><h3>点一个有数字的单元格</h3><p>这里会显示关系的具体含义和来源，帮助区分包依赖、服务协作与事件监听。</p></div>';return;}const edges=mxVisibleEdges().filter(e=>e.source===MX.cell.source&&e.target===MX.cell.target);el.innerHTML=`<div class="mx-proof"><h3>${esc(mxPkg(MX.cell.source)?.short)} → ${esc(mxPkg(MX.cell.target)?.short)}</h3>${edges.map(e=>`<p>${esc(e.label)} · ${mxSource(e.file,e.line)}</p>`).join('')||'<p>当前关系类型未记录这对节点。</p>'}<div class="actions">${btn('查看使用方',`data-package="${esc(MX.cell.source)}"`)}${btn('查看目标包',`data-package="${esc(MX.cell.target)}"`)}</div></div>`;}
function mxProfiles(){
  const a=D.matrix.profiles.find(p=>p.id===MX.profile),b=D.matrix.profiles.find(p=>p.id===MX.compare),ap=new Set(a.rows.map(r=>r.package)),bp=new Set(b.rows.map(r=>r.package));
  const common=[...ap].filter(x=>bp.has(x)).length,onlyA=[...ap].filter(x=>!bp.has(x)).length,onlyB=[...bp].filter(x=>!ap.has(x)).length;
  const opts=D.matrix.profiles.map(p=>[p.id,p.id]);
  const card=(p,id)=>`<article class="mx-profile-card">${mxSelect(id,opts,p.id)}<h2>${p.id}</h2><p>${esc(p.description)}</p><div class="mx-stack">${p.bundles.map((n,i)=>`<button class="mx-stack-row" data-package="${esc(n)}"><span>LAYER ${i+1}</span>${esc(n.replace('@deepseek-ai/dsh-',''))}</button>`).join('')}</div><div class="mx-summary-stat"><span><b>${new Set(p.rows.map(r=>r.package)).size}</b>被引用包</span><span><b>${p.rows.length}</b>命名条目</span></div>${mxSource(p.file,1,'查看模板 / 桌面组合依据 ↗')}</article>`;
  $('#mx-content').innerHTML=`<div class="mx-warning"><b>静态启动组合：</b>下列清单读取仓库模板和 bundle patch，不执行 !!js、不读取个人 profile，也不连接运行中的应用。它表示配置引用和显式开关，不是最终激活树。</div><div class="mx-profile-grid">${card(a,'mx-profile-left')}${card(b,'mx-profile-right')}</div><div class="mx-comparison"><div><b>${onlyA}</b><span>仅 ${esc(a.id)} 引用</span></div><div><b>${common}</b><span>两边共同引用</span></div><div><b>${onlyB}</b><span>仅 ${esc(b.id)} 引用</span></div></div>${a.id==='desktop'||b.id==='desktop'?'<div class="note"><b>Web 与 Desktop 为什么可能相同？</b>Desktop 复用 Web 的 bundle 组合，但还拥有 Electron 窗口、IPC、打包资源和保留 profile 的管理。相同包引用不表示相同启动宿主。</div>':''}
    <div class="section-head"><h2>启动的五个阶段</h2><p>条目书写顺序不等于激活顺序</p></div><div class="mx-profile-phases">${[['01','选择 profile','应用入口决定使用哪个组合。'],['02','叠加 bundle','按 profile 中的顺序应用。'],['03','覆盖配置','profile → home → --patch。'],['04','挂载 Loader','读取条目并解析插件与服务。'],['05','依赖就绪后激活','激活受服务与表达式控制。']].map(([n,t,d])=>`<div class="mx-profile-phase"><b>${n}</b><strong>${t}</strong><p class="small">${d}</p></div>`).join('')}</div>
    <h3>${esc(a.id)} 的命名配置条目</h3><div class="mx-search-area"><input class="input" id="mx-profile-query" type="search" placeholder="搜索条目 id 或模块名…" value="${esc(MX.profileQuery)}" aria-label="搜索配置条目">${mxSelect('mx-row-filter',[['all','全部声明'],['declared','没有显式禁用'],['disabled','显式禁用'],['conditional','表达式待运行时判断'],['deferred','预设 / 配置内延迟选择']],MX.rowFilter)}</div><div id="mx-profile-rows"></div>`;
  mxProfileRows();
}
function mxProfileRows(){
  const profile=D.matrix.profiles.find(p=>p.id===MX.profile),q=MX.profileQuery.toLowerCase();const rows=profile.rows.filter(r=>(!q||(r.id+' '+r.module).toLowerCase().includes(q))&&(MX.rowFilter==='all'||(MX.rowFilter==='deferred'?r.deferred:!r.deferred&&r.state===MX.rowFilter)));
  $('#mx-profile-rows').innerHTML=`<div class="result-info"><span>${rows.length} 条声明 · 相同包可被多次挂载</span><span>点击来源查看完整配置上下文</span></div><div class="mx-row-list">${rows.map(r=>`<div class="mx-config-row"><span class="mx-state ${r.deferred?'deferred':r.state}">${r.deferred?'延迟选择':r.state==='disabled'?'显式禁用':r.state==='conditional'?'待运行时判断':'配置声明'}</span><div><button data-package="${esc(r.package)}">${esc(r.module)}</button><small>id: ${esc(r.id||'未指定')} · ${esc(r.bundle.replace('@deepseek-ai/dsh-',''))}${r.expression?' · !!js '+esc(r.expression):''}</small><br>${mxSource(r.overrideFile||r.file,r.overrideFile?1:r.line,'配置来源 ↗')}</div></div>`).join('')||empty('没有符合条件的声明。')}</div><p class="mx-help">“配置声明”仅表示未看到显式禁用。预设内的条目要等预设被选择；条件表达式和服务可用性还可能阻止激活。</p>`;
}
function mxScene(){return D.matrix.scenes.find(s=>s.id===MX.scene)||D.matrix.scenes[0];}
function mxFlow(){
  const scene=mxScene();MX.step=Math.min(MX.step,scene.steps.length-1);const step=scene.steps[MX.step];
  $('#mx-content').innerHTML=`<div class="mx-scenario-grid">${D.matrix.scenes.map(s=>`<button class="mx-scenario ${s.id===scene.id?'active':''}" data-mx="scene" data-value="${s.id}">${esc(s.title)}<small>${esc(s.level)}</small></button>`).join('')}</div><div class="mx-warning"><b>教学演示 · 不是监控：</b>${esc(scene.assumption)} 动画速度只用于讲解，箭头表示本场景的阅读推进，不宣称每段都是直接函数调用。</div><div class="mx-workspace"><div><div class="mx-canvas-panel"><div class="mx-canvas-header"><div><h3>${esc(scene.title)}</h3><small>${esc(scene.goal)}</small></div><span class="mx-badge">TEACHING</span></div><svg class="mx-flow-svg" viewBox="0 0 800 430" role="img" aria-label="${esc(scene.title)}的教学步骤">${mxFlowSVG(scene)}</svg><div class="mx-legend"><span><i></i> 高亮节点：当前讲解的责任方</span><span><i class="amber"></i> 共 ${scene.steps.length} 步，不对应真实耗时</span></div></div><div class="mx-stepper">${mxAction('←','step',Math.max(0,MX.step-1))}${mxAction(MX.playing?'暂停':'▶ 播放','play-scene')}<input id="mx-step-range" type="range" min="0" max="${scene.steps.length-1}" value="${MX.step}" aria-label="场景步骤">${mxAction('→','step',Math.min(scene.steps.length-1,MX.step+1))}<small>${MX.step+1} / ${scene.steps.length}</small>${mxSelect('mx-speed',[['1800','快 · 1.8 秒'],['3500','常速 · 3.5 秒'],['6000','慢 · 6 秒']],String(MX.speed||3500))}</div><div class="mx-progress"><span>本场景已读 ${scene.steps.filter((_,i)=>matrixLearned.includes(scene.id+':'+i)).length} / ${scene.steps.length}</span><div class="mx-progress-track"><span style="width:${scene.steps.filter((_,i)=>matrixLearned.includes(scene.id+':'+i)).length/scene.steps.length*100}%"></span></div></div><details class="question"><summary>想一想：${esc(scene.question)}</summary><p>${esc(scene.answer)}</p></details></div>
    <aside class="mx-inspector"><div class="eyebrow">STEP ${String(MX.step+1).padStart(2,'0')} / ${esc(step.channel)}</div><h2>${esc(step.title)}</h2><p>${esc(step.text)}</p><div class="mx-lane-card"><b>输入</b><p>${esc(step.input)}</p></div><div class="mx-lane-card"><b>输出</b><p>${esc(step.output)}</p></div><div class="mx-lane-card mx-lane-event"><b>服务 / 事件 / 机制</b><p>${esc(step.event)}</p></div><div class="mx-fact"><strong>责任方</strong><button data-package="${esc(step.package)}">${esc(mxPkg(step.package).short)} ↗</button></div><div class="mx-fact"><strong>源码依据</strong>${mxSource(step.file,step.line,step.file.split('/').at(-1)+':'+step.line+' ↗')}</div><div class="actions">${mxAction(matrixLearned.includes(scene.id+':'+MX.step)?'✓ 已读':'标记已读','mark-step')}${mxAction('在组态中定位','locate-scene')}</div></aside></div>`;
}
function mxFlowSVG(scene){
  const positions=scene.steps.map((_,i)=>{const row=Math.floor(i/3),col=row%2?2-i%3:i%3;return [45+col*255,55+row*180];});
  let paths='';for(let i=0;i<positions.length-1;i++){const [x,y]=positions[i],[nx,ny]=positions[i+1];const down=ny!==y;let path;if(down)path=`M${x+100} ${y+94} V${ny-12}`;else if(nx>x)path=`M${x+208} ${y+47} H${nx-10}`;else path=`M${x-7} ${y+47} H${nx+218}`;paths+=`<path class="mx-trace-line ${i===MX.step-1?'active':''}" d="${path}" marker-end="url(#mx-flow-arrow)"/>`;}
  return `<defs><marker id="mx-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#b6cba9"/></marker></defs>${paths}`+scene.steps.map((s,i)=>{const [x,y]=positions[i],p=mxPkg(s.package);return `<g class="mx-flow-node ${i===MX.step?'active':i<MX.step?'past':''}" role="button" tabindex="0" aria-label="步骤 ${i+1}：${esc(s.title)}" data-mx-step="${i}"><rect x="${x}" y="${y}" width="208" height="94" rx="12"/><text class="mx-flow-index" x="${x+14}" y="${y+24}">0${i+1} / ${esc(s.channel.slice(0,12))}</text><text x="${x+14}" y="${y+48}">${esc(s.title)}</text><text class="mx-flow-package" x="${x+14}" y="${y+74}">${esc(p.short.length>28?p.short.slice(0,26)+'…':p.short)}</text></g>`;}).join('');
}
function mxPlayScene(){if(MX.playing){matrixPause();mxFlow();return;}const scene=mxScene();if(MX.step===scene.steps.length-1)MX.step=0;MX.playing=setInterval(()=>{if(document.querySelector('dialog[open]'))return;if(MX.step>=scene.steps.length-1){matrixPause();toast('本场景演示完成，可以展开思考题。');}else MX.step++;if(MX.view==='flow'&&currentPage==='matrix')mxFlow();else matrixPause();},MX.speed||3500);mxFlow();}

const mxEventHints={
  'turn/start':['一轮工作开始','执行边界','agent'], 'step/start':['一个模型步骤开始','执行边界','agent'],
  'user/message':['用户角色消息被记录','消息载荷','agent'], 'system/message':['系统提示词变更被记录','消息载荷','agent'],
  'developer/message':['开发者消息被记录','消息载荷','agent'], 'request/header':['模型请求配置被记录','请求配置','agent'],
  'request/context':['模型请求上下文被记录','请求配置','agent'], 'assistant/message':['助手消息完成结算','消息载荷','agent'],
  'assistant/attempt':['模型尝试已结算','尝试记录','agent'], 'tool/call':['工具调用事实','工具工作','tools'],
  'tool/result':['工具结果被记录','消息载荷','tools'], 'step/end':['本步骤结束','执行边界','agent'],
  'turn/end':['本轮结束及其原因','执行边界','agent'], 'agent/inbox/spliced':['收件箱发生变更','排队状态','agent']
};
function mxSample(){return {origin:'teaching',name:'手工编排的教学事件示例',header:{type:'session',version:4,id:'teaching-only'},events:[
  {type:'turn/start',seq:0,time:0,data:{turn:1}},
  {type:'step/start',seq:1,time:20,data:{turn:1,step:1}},
  {type:'user/message',seq:2,time:30,data:{content:'教学示例：请说明这个项目。'}},
  {type:'request/header',seq:3,time:35,data:{note:'此处省略完整请求配置，仅说明记录位置。'}},
  {type:'assistant/message',seq:4,time:1200,data:{message:{content:'教学示例：项目由插件组成。'}}},
  {type:'step/end',seq:5,time:1205,data:{turn:1,step:1}},
  {type:'turn/end',seq:6,time:1210,data:{turn:1,reason:{kind:'completed'}}}
]};}
/** Admit bounded event envelopes for inspection only, without reconstructing DSH state. */
function mxParseRecording(text,name){
  if(text.length>8*1024*1024)throw new Error('记录超过 8 MiB；请使用较小的已脱敏记录。');
  let rows,header=null;
  const trimmed=text.replace(/^\uFEFF/,'').trim();if(!trimmed)throw new Error('文件为空。');
  try{const value=JSON.parse(trimmed);if(Array.isArray(value))rows=value;else if(value&&Array.isArray(value.events)){header=value.header||null;rows=value.events;}else rows=[value];}
  catch(error){if(error instanceof SyntaxError){try{rows=trimmed.split(/\r?\n/).filter(l=>l.trim()).map(l=>JSON.parse(l));}catch(_error){throw new Error('不是有效的 JSON 或逐行 JSONL 文件。');}}else throw error;}
  if(rows[0]?.type==='session'){header=rows[0];rows=rows.slice(1);}
  if(header&&(typeof header!=='object'||Array.isArray(header)||header.version!==4||typeof header.id!=='string'))throw new Error('只支持 version=4 且带会话 id 的头部；本工具不执行历史格式迁移。');
  if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw new Error('需要 1—10,000 条有序事件。');
  let previous=-1;
  const events=rows.map((r,i)=>{
    if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.type!=='string'||!r.type||r.type.length>160||!Number.isSafeInteger(r.seq)||r.seq<0||r.seq<=previous||!Number.isSafeInteger(r.time)||r.time<0||!r.data||typeof r.data!=='object'||Array.isArray(r.data))throw new Error(`第 ${i+1} 条事件需包含 type、严格递增的非负 seq、非负毫秒 time 和对象 data。`);
    previous=r.seq;return {type:r.type,seq:r.seq,time:r.time,data:r.data,ignorable:r.ignorable===true};
  });
  return {origin:'imported',name,header,events};
}
function mxReplay(){
  if(!MX.replay)MX.replay=mxSample();const log=MX.replay;MX.replayIndex=Math.min(MX.replayIndex,log.events.length-1);const e=log.events[MX.replayIndex],hint=mxEventHints[e.type];const delta=MX.replayIndex?e.time-log.events[MX.replayIndex-1].time:0;
  $('#mx-content').innerHTML=`<div class="mx-import"><div><h3>观察 Session 中真实记录的事实</h3><p>导入明文 JSONL（v4 头部）或含 events 的 JSON。支持无头部的事件数组，但只校验事件信封，不恢复 Agent，也不执行工具。</p><p>最多 8 MiB / 10,000 条；只在当前页面内存中读取，不上传，不写入学习进度。</p></div><div class="actions">${mxAction('选择本地记录','import-record')}${mxAction('载入教学示例','sample')}${mxAction('下载导入格式示例','sample-download')}</div></div><input id="mx-record-file" class="mx-file-input" type="file" accept=".json,.jsonl" aria-label="导入会话记录">
    ${MX.error?`<div class="mx-warning mx-error" role="alert">${esc(MX.error)}</div>`:''}
    <div class="mx-warning"><b>${log.origin==='teaching'?'教学示例 · 非真实日志':'导入记录 · 事件观察模式'}：</b>${esc(log.name)}。${log.origin==='teaching'?'内容和时间均为手工编排，不是完整有效的 DSH 执行会话。':'未校验所有事件负载及跨事件约束，未识别的类型会原样保留并标注。'} 播放只按顺序逐条展示，间隔不代表真实耗时。</div>
    <div class="mx-workspace"><div><div class="mx-canvas-panel"><div class="mx-canvas-header"><div><h3>持久记录时间线</h3><small>${log.events.length} EVENTS / ${log.origin==='teaching'?'SYNTHETIC':'IMPORTED'} / 按 seq 顺序</small></div><span class="mx-badge">${MX.replayIndex+1} / ${log.events.length}</span></div><div class="mx-replay-list" id="mx-replay-list">${log.events.slice(Math.max(0,MX.replayIndex-30),Math.min(log.events.length,MX.replayIndex+50)).map(r=>`<button class="mx-event-row ${r===e?'active':''}" data-mx="replay-seq" data-value="${r.seq}"><time>#${r.seq}</time><span>${esc(mxEventHints[r.type]?.[0]||'未解释事件')}<small style="display:block">${esc(r.type)}</small></span><small>${r.time-log.events[0].time} ms</small></button>`).join('')}</div></div><div class="mx-stepper">${mxAction('←','replay-step',Math.max(0,MX.replayIndex-1))}${mxAction(MX.playing?'暂停':'▶ 顺序播放','play-record')}<input id="mx-replay-range" type="range" min="0" max="${log.events.length-1}" value="${MX.replayIndex}" aria-label="记录回放位置">${mxAction('→','replay-step',Math.min(log.events.length-1,MX.replayIndex+1))}<small>${MX.replayIndex+1} / ${log.events.length}</small></div><p class="mx-help">时间列显示与首条记录的 time 差值；不等于某个调用的执行耗时。日志中的时间可能不是单调时钟。</p></div>
    <aside class="mx-inspector"><div class="eyebrow">EVENT #${e.seq}</div><h2>${esc(e.type)}</h2>${badge(hint?hint[1]:'未解释，保留原始数据',!!hint)}<div class="mx-fact"><strong>原始 time</strong><small>${e.time} · 与上一条相差 ${delta} ms</small></div><div class="mx-lane-card"><b>执行与持久事实</b><p>${esc(hint?.[0]||'本教学工具没有此事件的语义解释；不据此恢复任何状态。')}</p></div><div class="mx-lane-card mx-lane-event"><b>模型侧能够知道什么</b><p>${['user/message','system/message','developer/message','assistant/message','tool/result'].includes(e.type)?'这里保存了消息相关载荷。但实际模型历史还取决于 surface 操作、投影与请求配置，不能把此载荷列表当成完整模型请求。':'此记录不直接等于发送给模型的一条消息。'}</p></div><div class="mx-lane-card"><b>界面实时流</b><p>单凭此持久事件无法还原当时全部实时 chunk 或浏览器内部行为，本视图不会补造这些调用。</p></div><h3>原始 data</h3><pre class="mx-raw">${esc(JSON.stringify(e.data,null,2))}</pre>${mxSource('packages/core/session/src/types.ts',493,'查看 SessionEvent 信封定义 ↗')}</aside></div>`;
}
function mxDownload(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function mxImportProgress(text){
  const value=JSON.parse(text);
  if(!value||value.format!=='qishu-learning-progress'||value.version!==1||!Array.isArray(value.learned)||!Array.isArray(value.bookmarks)||!Array.isArray(value.seen)||value.learned.length>1000||value.bookmarks.length>1000||value.seen.length>1000)throw new Error('不是支持的栖树学习进度文件。');
  const allowed=new Set(D.matrix.scenes.flatMap(s=>s.steps.map((_,i)=>s.id+':'+i)));
  if(value.learned.some(v=>typeof v!=='string'||!allowed.has(v)))throw new Error('学习步骤不属于当前版本。');
  const guideKeys=new Set(D.guide.flows.flatMap(f=>f.steps.map((_,i)=>f.id+':'+i)));
  if(value.seen.some(v=>typeof v!=='string'||!guideKeys.has(v)))throw new Error('源码阅读进度不属于当前版本。');
  if(value.bookmarks.some(b=>!b||typeof b.file!=='string'||D.files[b.file]===undefined||!Number.isSafeInteger(b.line)||b.line<1||b.line>D.files[b.file].split('\n').length))throw new Error('书签文件或行号超出当前快照。');
  matrixLearned=[...new Set([...matrixLearned,...value.learned])];seen=[...new Set([...seen,...value.seen])];
  const merged=new Map([...bookmarks,...value.bookmarks.map(b=>({file:b.file,line:b.line}))].map(b=>[b.file+':'+b.line,b]));bookmarks=[...merged.values()];
  save('matrix-learned',matrixLearned);save('seen',seen);save('bookmarks',bookmarks);
}
function mxChoosePackage(name){if(!mxPkg(name))return;MX.selected=name;MX.nodePage=0;MX.area=mxArea(name)?.id||'all';MX.query='';MX.neighbors=false;mxView('map');}
function mxReadFile(file,callback,errorCallback){if(!file)return;if(file.size>8*1024*1024){errorCallback(new Error('文件超过 8 MiB。'));return;}file.text().then(callback).catch(errorCallback);}
function bindMatrix(){
  document.addEventListener('click',e=>{
    if(currentPage!=='matrix')return;
    const node=e.target.closest('[data-mx-node]');if(node){if(node.dataset.areaNode==='true'){MX.area=node.dataset.mxNode;MX.nodePage=0;MX.query='';MX.neighbors=false;mxMap();}else{MX.selected=node.dataset.mxNode;drawMxMap();mxInspector();}return;}
    const stepNode=e.target.closest('[data-mx-step]');if(stepNode){matrixPause();MX.step=Number(stepNode.dataset.mxStep);mxFlow();return;}
    const b=e.target.closest('[data-mx]');if(!b)return;const action=b.dataset.mx,v=b.dataset.value;
    switch(action){
      case 'view':mxView(v);break;
      case 'begin':MX.scene='chat';MX.step=0;mxView('flow');break;
      case 'mode':MX.mode=v;mxMap();break;
      case 'reset-camera':MX.yaw=-18;MX.tilt=48;MX.zoom=1;mxMap();break;
      case 'zoom':MX.zoom=Math.max(.7,Math.min(1.7,MX.zoom+(v==='in'?.1:-.1)));drawMxMap();break;
      case 'areas':MX.area='all';MX.query='';MX.neighbors=false;MX.nodePage=0;mxMap();break;
      case 'neighbors':MX.neighbors=!MX.neighbors;MX.area='all';MX.query='';MX.nodePage=0;mxMap();break;
      case 'node-page':MX.nodePage=Number(v);drawMxMap();break;
      case 'select-package':mxChoosePackage(v);break;
      case 'select-from-matrix':mxChoosePackage(v);break;
      case 'locate-matrix':MX.area='all';MX.query='';MX.neighbors=true;MX.matrixPage=0;mxView('relations');break;
      case 'matrix-page':MX.matrixPage=Number(v);mxRelations();break;
      case 'cell':MX.cell={source:b.dataset.source,target:b.dataset.target};mxCellProof();$('#mx-cell-proof').scrollIntoView({block:'nearest'});break;
      case 'scene':matrixPause();MX.scene=v;MX.step=0;mxFlow();break;
      case 'step':matrixPause();MX.step=Number(v);mxFlow();break;
      case 'play-scene':mxPlayScene();break;
      case 'mark-step':{const key=MX.scene+':'+MX.step;matrixLearned=matrixLearned.includes(key)?matrixLearned.filter(x=>x!==key):[...matrixLearned,key];save('matrix-learned',matrixLearned);mxFlow();break;}
      case 'locate-scene':matrixPause();mxChoosePackage(mxScene().steps[MX.step].package);break;
      case 'import-record':matrixPause();$('#mx-record-file').click();break;
      case 'sample':matrixPause();MX.replay=mxSample();MX.replayIndex=0;MX.error='';mxReplay();break;
      case 'sample-download':mxDownload('qishu-teaching-event-envelopes.json',{notice:'手工教学样例，仅用于事件观察，不是完整 DSH 会话。',events:mxSample().events});break;
      case 'replay-step':matrixPause();MX.replayIndex=Number(v);mxReplay();break;
      case 'replay-seq':matrixPause();MX.replayIndex=MX.replay.events.findIndex(e=>e.seq===Number(v));mxReplay();break;
      case 'play-record':if(MX.playing){matrixPause();mxReplay();}else{if(MX.replayIndex===MX.replay.events.length-1)MX.replayIndex=0;MX.playing=setInterval(()=>{if(document.querySelector('dialog[open]'))return;if(MX.replayIndex>=MX.replay.events.length-1)matrixPause();else MX.replayIndex++;if(currentPage==='matrix'&&MX.view==='replay')mxReplay();else matrixPause();},1100);mxReplay();}break;
      case 'export-progress':mxDownload('qishu-learning-progress.json',{format:'qishu-learning-progress',version:1,head:D.meta.head,learned:matrixLearned,seen,bookmarks});break;
      case 'import-progress':$('#mx-progress-file').click();break;
    }
  });
  let debounce;
  document.addEventListener('input',e=>{
    if(currentPage!=='matrix')return;const id=e.target.id,v=e.target.value;
    if(id==='mx-yaw'||id==='mx-tilt'){MX[id==='mx-yaw'?'yaw':'tilt']=Number(v);drawMxMap();}
    if(id==='mx-search'){MX.query=v;MX.nodePage=0;MX.matrixPage=0;clearTimeout(debounce);debounce=setTimeout(()=>{if(currentPage!=='matrix')return;if(MX.view==='map'){drawMxMap();}else if(MX.view==='relations'){const pos=e.target.selectionStart;mxRelations();$('#mx-search').focus();$('#mx-search').setSelectionRange(pos,pos);}},180);}
    if(id==='mx-profile-query'){MX.profileQuery=v;mxProfileRows();}
    if(id==='mx-step-range'){matrixPause();MX.step=Number(v);mxFlow();}
    if(id==='mx-replay-range'){matrixPause();MX.replayIndex=Number(v);mxReplay();}
  });
  document.addEventListener('change',e=>{
    if(currentPage!=='matrix')return;const id=e.target.id,v=e.target.value;
    if(id==='mx-area'||id==='mx-relation'){MX[id==='mx-area'?'area':'relation']=v;MX.nodePage=0;MX.matrixPage=0;MX.cell=null;paintMatrixView();}
    if(id==='mx-profile-left'||id==='mx-profile-right'){MX[id==='mx-profile-left'?'profile':'compare']=v;mxProfiles();}
    if(id==='mx-row-filter'){MX.rowFilter=v;mxProfileRows();}
    if(id==='mx-speed'){const playing=!!MX.playing;matrixPause();MX.speed=Number(v);if(playing)mxPlayScene();}
    if(id==='mx-record-file')mxReadFile(e.target.files[0],text=>{try{const next=mxParseRecording(text,e.target.files[0].name);matrixPause();MX.replay=next;MX.replayIndex=0;MX.error='';if(currentPage==='matrix'&&MX.view==='replay')mxReplay();}catch(error){MX.error=error.message;if(currentPage==='matrix'&&MX.view==='replay')mxReplay();}},error=>{MX.error=error.message;if(currentPage==='matrix'&&MX.view==='replay')mxReplay();});
    if(id==='mx-progress-file')mxReadFile(e.target.files[0],text=>{try{mxImportProgress(text);toast('已合并学习进度与书签');if(currentPage==='matrix')paintMatrixView();}catch(error){toast('无法导入：'+error.message);}},error=>toast(error.message));
  });
  document.addEventListener('keydown',e=>{if(currentPage!=='matrix'||document.querySelector('dialog[open]'))return;if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-mx-node],[data-mx-step]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  let drag=null;
  document.addEventListener('pointerdown',e=>{const stage=e.target.closest('#mx-stage');if(!stage||e.target.closest('[data-mx-node]')||MX.mode==='flat'||e.pointerType==='touch')return;drag={x:e.clientX,y:e.clientY,yaw:MX.yaw,tilt:MX.tilt};stage.setPointerCapture(e.pointerId);stage.classList.add('dragging');});
  document.addEventListener('pointermove',e=>{if(!drag||!$('#mx-stage'))return;MX.yaw=Math.max(-45,Math.min(45,drag.yaw+(e.clientX-drag.x)*.2));MX.tilt=Math.max(15,Math.min(65,drag.tilt-(e.clientY-drag.y)*.15));$('#mx-yaw').value=String(MX.yaw);$('#mx-tilt').value=String(MX.tilt);drawMxMap();});
  const endDrag=()=>{drag=null;$('#mx-stage')?.classList.remove('dragging');};document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&MX.playing){matrixPause();if(currentPage==='matrix')paintMatrixView();}});
}
