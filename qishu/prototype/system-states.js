/* Presentation-only failures never clear the workspace or its saved sessions. */
'use strict';
const systemDemo={mode:'',connection:'connected',timer:null,history:'idle'};
function resetSystemDemo(){clearTimeout(systemDemo.timer);systemDemo.mode='';systemDemo.connection='connected';systemDemo.history='idle';}
function systemDemoMenu(){return `<h3 class="system-menu-title">系统状态</h3><div class="modal-list">${[['connection','globe','连接中断','断开、重连失败与恢复，保留草稿'],['fault','info','根故障页','重试渲染、重新加载与诊断信息'],['empty','folder','空态','会话、工作区与工具入口没有内容'],['loading','clock','加载骨架','首屏加载与历史分页']].map(([id,ic,title,desc])=>`<button class="choice-row" data-action="system-start" data-scenario="${id}">${icon(ic)}<span><strong>${title}</strong><small>${desc}</small></span>${icon('next')}</button>`).join('')}</div><h3 class="system-menu-title">审批与提问</h3>`;}
function systemEmpty(ic,title,description,action,label){return `<div class="system-empty">${icon(ic)}<h3>${title}</h3><p>${description}</p><button class="btn" data-action="${action}">${label}</button></div>`;}
function skeletonRows(n){return `<div aria-hidden="true">${Array.from({length:n},(_,i)=>`<div class="system-skeleton" style="width:${i%3===0?65:92}%"></div>`).join('')}</div>`;}
function applySystemDemo(){
 if(!systemDemo.mode)return;
 if(systemDemo.mode==='fault'){
  $('#root').innerHTML=`<main class="system-fault">${brand()}<section><span class="system-fault-symbol">${icon('info')}</span><div class="eyebrow">QISHU WORKSPACE</div><h1 id="fault-title" tabindex="-1">工作台暂时无法显示</h1><p>页面遇到了一点问题。你可以先重试；本机保存的会话仍然保留。</p><div class="system-fault-actions"><button class="btn primary" data-action="system-retry">${icon('refresh')}重试渲染</button><button class="btn" data-action="system-reload">重新加载页面</button><button class="text-button" data-action="system-diagnostic">复制诊断信息</button></div><details><summary>查看诊断信息</summary><pre id="system-diagnostic">QISHU / ROOT_RENDER_ERROR\n来源：本地故障演示\n未连接宿主，不包含账号与会话内容。</pre></details><div class="system-demo-note">原型状态演示 <button class="text-button" data-action="system-exit">退出演示</button></div></section></main>`;return;
 }
 const center=$('.center');if(!center)return;
 const controls=systemDemo.mode==='connection'?`<button data-action="system-disconnect">模拟断开</button><button data-action="system-fail">模拟重连失败</button>`:systemDemo.mode==='loading'?`<button data-action="system-loaded">完成首屏加载</button><button data-action="system-history">历史分页演示</button>`:'';
 center.insertAdjacentHTML('afterbegin',`<div class="system-demo-bar"><span>原型演示 · ${{connection:'连接状态',empty:'空态',loading:'加载状态',history:'历史分页'}[systemDemo.mode]}</span><div>${controls}<button data-action="system-exit">退出演示</button></div></div>`);
 if(systemDemo.mode==='connection')updateConnectionDom();
 if(systemDemo.mode==='empty'){
  $('.session-scroll').innerHTML=systemEmpty('chat','还没有会话','说说你的任务，开始第一段对话。','system-compose','开始对话');
  $('#right-content').innerHTML=systemEmpty('folder','这里还没有内容','先在对话中描述任务，再整理相关资料。','system-compose','去对话');
  $('#center-scroll').innerHTML=systemEmpty('spark','从一句话开始','告诉奇术你想完成什么，我们一起往下做。','system-compose','描述任务');
  if(!$('#prompt'))center.insertAdjacentHTML('beforeend',`<div class="chat-composer">${composer()}</div>`);
 }
 if(systemDemo.mode==='loading'){
  $('.session-scroll').innerHTML=`<div class="system-loading" aria-busy="true"><span role="status">正在加载会话…</span>${skeletonRows(7)}</div>`;
  $('#center-scroll').innerHTML=`<div class="system-loading system-loading-main" aria-busy="true"><span role="status">正在准备你的工作台…</span>${skeletonRows(4)}<div class="system-skeleton-block"></div>${skeletonRows(3)}</div>`;
  $('#right-content').innerHTML=`<div class="system-loading" aria-label="正在加载工作区" aria-busy="true">${skeletonRows(5)}</div>`;
  $('.chat-composer')?.setAttribute('hidden','');
 }
 if(systemDemo.mode==='history'){
  $('#center-scroll').innerHTML=`<div class="system-history"><div id="history-status"></div><div class="system-history-records"><p>今天 · 已加载的对话</p><div class="detail-banner">巡检计划已整理。向上加载可查看之前的讨论。</div></div></div>`;
  updateHistoryDom();
 }
}
function updateConnectionDom(){
 if(!$('.center')||systemDemo.mode!=='connection')return;
 const status=systemDemo.connection,blocked=!['connected','restored'].includes(status);
 const labels={disconnected:'连接已断开',reconnecting:'正在重新连接…',failed:'重连未成功，请稍后重试',restored:'连接已恢复',connected:'连接正常'};
 let bar=$('#system-connection');if(!bar){$('.center').insertAdjacentHTML('beforeend','<div id="system-connection" class="system-connection"><span role="status" aria-live="polite" id="connection-message"></span><button class="text-button" data-action="system-reconnect">重新连接</button></div>');bar=$('#system-connection');}
 $('#connection-message').textContent=labels[status];const b=$('[data-action="system-reconnect"]',bar);b.hidden=!blocked;b.disabled=status==='reconnecting';
 let hint=$('#connection-hint');if(!hint&&$('.composer-shell')){$('.composer-shell').insertAdjacentHTML('afterbegin','<p id="connection-hint" class="connection-hint"></p>');hint=$('#connection-hint');}
 if(hint){hint.hidden=!blocked;hint.textContent='连接恢复后才能发送；你可以继续编辑，草稿会保留。';}
 if(typeof deliveryBlock==='function'){const session=current();document.querySelectorAll('[data-action="queue-steer"]').forEach(button=>{button.disabled=!session||!conversationRuns.has(session.id)||!!deliveryBlock(session);});}
 const sendButton=$('.send');if(sendButton){sendButton.disabled=blocked||(typeof deliveryBlock==='function'&&(!!deliveryBlock(current())||!!firstSubmission));if(blocked)sendButton.setAttribute('aria-describedby','connection-hint');else sendButton.removeAttribute('aria-describedby');}
}
function updateHistoryDom(){
 const area=$('#history-status');if(!area)return;
 const phase=systemDemo.history;
 area.innerHTML=phase==='loading'?'<p role="status" aria-busy="true">正在加载更早的消息…</p>':phase==='failed'?'<p role="alert">更早的消息未能加载，当前内容仍可阅读。</p><button class="btn" data-action="history-load">重试</button>':phase==='done'?'<p role="status">已加载全部历史消息</p>':'<button class="btn" data-action="history-load">加载更早的消息</button>';
 if(phase!=='done')area.insertAdjacentHTML('beforeend','<button class="text-button" data-action="history-fail">模拟分页失败</button>');
}
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-action]');if(!b||b.disabled)return;
 const a=b.dataset.action;
 if(systemDemo.mode==='empty'&&a==='catalog'){
  event.stopImmediatePropagation();openModal(categories[b.dataset.category].title,systemEmpty('box','暂无可用内容','当前目录还没有配置内容，可以先回到对话描述需求。','system-compose','回到对话'));return;
 }
 if(a==='system-start'){
  resetSystemDemo();stopPending();systemDemo.mode=b.dataset.scenario;systemDemo.connection=systemDemo.mode==='connection'?'disconnected':'connected';closeModal();renderApp();if(systemDemo.mode==='fault')$('#fault-title').focus();return;
 }
 if(a==='system-exit'||a==='system-retry'||a==='system-loaded'){resetSystemDemo();renderApp();$('#prompt')?.focus();return;}
 if(a==='system-reload'){location.reload();return;}
 if(a==='system-diagnostic'){try{await navigator.clipboard.writeText($('#system-diagnostic').textContent);toast('诊断信息已复制。');}catch{toast('无法自动复制，请展开诊断信息手动复制。');}return;}
 if(a==='system-compose'){resetSystemDemo();closeModal();newChat();return;}
 if(a==='system-disconnect'||a==='system-fail'){clearTimeout(systemDemo.timer);systemDemo.connection=a==='system-fail'?'failed':'disconnected';updateConnectionDom();return;}
 if(a==='system-reconnect'){
  systemDemo.connection='reconnecting';updateConnectionDom();systemDemo.timer=setTimeout(()=>{systemDemo.connection='restored';updateConnectionDom();systemDemo.timer=setTimeout(()=>{systemDemo.connection='connected';updateConnectionDom();},2400);},1100);return;
 }
 if(a==='system-history'){systemDemo.mode='history';systemDemo.history='idle';renderApp();return;}
 if(a==='history-fail'){clearTimeout(systemDemo.timer);systemDemo.history='failed';updateHistoryDom();return;}
 if(a==='history-load'){
  systemDemo.history='loading';updateHistoryDom();systemDemo.timer=setTimeout(()=>{systemDemo.history='done';const records=$('.system-history-records');if(records)records.insertAdjacentHTML('afterbegin','<div class="detail-banner"><strong>昨天 · 巡检准备</strong><p>已确认巡检范围：二车间与消防通道。</p></div>');updateHistoryDom();},1000);
 }
},true);
