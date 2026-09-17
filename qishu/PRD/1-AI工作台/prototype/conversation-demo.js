/* Local conversation state: timers belong to sessions; navigation never cancels a turn. */
'use strict';
const conversationRuns=new Map();
const conversationDrafts=new Map();
const conversationScroll=new Map();
let renderedConversationKey=null;
let nextLateFailure=false;
let firstSubmission=null;
let nextSendFailure=false;
let modelBlocked=false;
let managementFailure=false;
let nextCreateFailure=false;
let queueFailure=false;
const baseRenderApp=renderApp,baseInteractionView=interactionView,baseSystemMenu=systemDemoMenu,baseStartInteraction=startInteraction;
const draftKey=()=>`${state.workspace}/${ws().current||'new'}`;
function rememberDraft(){conversationDrafts.set(draftKey(),{text:ui.draft,attachments:[...ui.attachments]});}
startInteraction=function(scenario){rememberDraft();cancelFirstSubmission();baseStartInteraction(scenario);restoreDraft();renderApp();};
function restoreDraft(){const d=conversationDrafts.get(draftKey());ui.draft=d?.text||'';ui.attachments=[...(d?.attachments||[])];}
function conversationVisible(s){return !!user&&current()===s;}
function conversationNotice(text,action,label){return `<div class="conversation-notice" role="status"><span>${esc(text)}</span>${action?`<button class="btn" data-action="${action}">${esc(label)}</button>`:''}</div>`;}
systemDemoMenu=function(){return baseSystemMenu().replace('<h3 class="system-menu-title">审批与提问</h3>','')+`<h3 class="system-menu-title">发送与恢复</h3><div class="modal-list">${[
 ['stream','流式输出与队列','逐段生成、停止、排队、切会话继续'],['first','首次发送','创建等待、取消与重试'],['create-error','创建失败','创建失败后保留输入并重试'],['partial','创建部分成功','会话已创建，工作区挂接失败'],['send-error','发送失败','保留草稿，重试后发送'],['late-error','延迟发送失败','先输入新草稿，再观察失败内容独立保留'],['model','模型不可用','禁用发送，恢复模型后继续'],['open-error','会话加载失败','原位置重试，不清空会话'],['manage-error','管理操作失败','下一次归档或重命名失败'],['card-error','交互卡局部故障','请求仍在，重试卡片后作答']
 ].map(([id,title,description])=>`<button class="choice-row" data-action="conversation-scenario" data-scenario="${id}">${icon('chat')}<span><strong>${title}</strong><small>${description}</small></span>${icon('next')}</button>`).join('')}</div><h3 class="system-menu-title">审批与提问</h3>`;};
interactionView=function(){const r=current()?.interaction;return r?.renderError?conversationNotice('确认卡片暂时无法显示，请求仍在等待你的回答。','card-retry','重试卡片'):baseInteractionView();};
function queueView(s){return (s?.queue?.length?`<section class="conversation-queue" aria-label="待发队列"><strong>待发队列 · ${s.queue.length}</strong><p>结束当前轮后，队列按顺序继续。</p>${s.queue.map((q,i)=>`<div class="queue-item"><span>${i+1}. ${esc(q.text)}</span><div><button class="text-button" data-action="queue-edit" data-id="${q.id}">编辑</button><button class="text-button" data-action="queue-remove" data-id="${q.id}">移除</button><button class="text-button" data-action="queue-steer" data-id="${q.id}"${!conversationRuns.has(s.id)||deliveryBlock(s)?' disabled':''}>引导当前轮</button></div></div>`).join('')}<button class="text-button" data-action="queue-fail">模拟下一次队列操作失败</button>${!conversationRuns.has(s.id)?'<button class="btn" data-action="queue-resume">继续待发队列</button>':''}${s.queueError?`<p role="alert">${esc(s.queueError)}</p>`:''}</section>`:'');}
function decorateConversation(){
 const s=current(),shell=$('.composer-shell'),prompt=$('#prompt'),button=$('.send');
 if(!shell||!prompt||!button)return;
 const run=s&&conversationRuns.get(s.id),blocked=!!deliveryBlock(s);
 prompt.readOnly=!!firstSubmission;
 button.disabled=blocked||!!firstSubmission;
 button.dataset.action='send';button.setAttribute('aria-label',run?'加入待发队列':'发送消息');button.classList.remove('is-stop');button.innerHTML=icon('up');
 if(run)button.insertAdjacentHTML('beforebegin','<button class="btn" data-action="stop">停止生成</button>');
 if(s?.interaction)shell.insertAdjacentHTML('afterbegin',conversationNotice('请先完成对话中的确认，再发送新任务。'));
 if(modelBlocked)shell.insertAdjacentHTML('afterbegin',conversationNotice('当前模型不可用。草稿已保留。','model-restore','恢复模型（演示）'));
 if(firstSubmission)shell.insertAdjacentHTML('afterbegin',conversationNotice('正在创建会话，本次内容已冻结…','first-cancel','取消本次发送'));
 if(s?.sendError||(!s&&ui.sendError))shell.insertAdjacentHTML('afterbegin',conversationNotice(s?.sendError||ui.sendError,'send-retry','重试发送'));
 shell.insertAdjacentHTML('afterbegin',queueView(s));
 if(s?.failedSends?.length)shell.insertAdjacentHTML('afterbegin',`<section class="conversation-notice" role="alert"><span>发送失败；新草稿未改变。</span>${s.failedSends.map(f=>`<div><p>${esc(f.text)}</p><button class="btn" data-action="failed-retry" data-id="${f.id}">重试这条内容</button></div>`).join('')}</section>`);
 if(s?.attachError)shell.insertAdjacentHTML('afterbegin',conversationNotice('会话已创建，但未归入工作区；不会重复创建。','attach-retry','重试归入工作区'));
 if(s?.openError)$('#center-scroll').innerHTML=conversationNotice('此会话暂时无法加载，原有消息仍然保留。','open-retry','重新加载会话');
 if(run&&!s.openError){const area=$('#center-scroll');area.insertAdjacentHTML('beforeend','<div class="stream-controls"><span role="status">正在生成 · 本地模拟</span><button class="text-button" data-action="stream-fail">模拟生成中断</button><button class="text-button" data-action="stream-bottom">回到最新消息</button></div>');}
}
function rememberScroll(){const area=$('#center-scroll');if(area&&renderedConversationKey)conversationScroll.set(renderedConversationKey,{top:area.scrollTop,follow:area.scrollHeight-area.scrollTop-area.clientHeight<90});}
renderApp=function(){const p=$('#prompt'),focused=document.activeElement===p,selection=p?[p.selectionStart,p.selectionEnd]:null;rememberScroll();ui.pending=current()&&conversationRuns.has(current().id)?current().id:null;baseRenderApp();decorateConversation();renderedConversationKey=draftKey();const area=$('#center-scroll'),position=conversationScroll.get(renderedConversationKey);if(area)area.scrollTop=position?.follow===false?position.top:area.scrollHeight;if(focused&&$('#prompt')){$('#prompt').focus({preventScroll:true});if(selection)$('#prompt').setSelectionRange(...selection);}};
function deliveryBlock(s){if(!user)return '请先登录。';if(!['connected','restored'].includes(systemDemo.connection))return '连接尚未恢复，内容已保留。';if(modelBlocked)return '当前模型不可用，内容已保留。';if(s?.interaction)return '请先完成对话中的确认。';if(s?.openError||systemDemo.mode==='loading')return '请等待会话加载完成。';return '';}
function archiveBlock(s){return conversationRuns.has(s.id)||s.queue?.length||s.interaction?'请先结束生成、处理待发队列并完成确认，再归档会话。':'';}
function steerQueued(s,id){const q=s.queue?.find(x=>x.id===id),run=conversationRuns.get(s.id);if(!q||!run||deliveryBlock(s)){s.queueError='当前轮已结束或暂不可引导，待发任务未改变。';refreshConversation(s);return false;}s.queue=s.queue.filter(x=>x!==q);run.steering.push(q.text);s.messages.push({role:'user',text:'引导当前轮：'+q.text});save();refreshConversation(s);return true;}
function refreshConversation(s){if(conversationVisible(s))renderApp();}
function drainQueue(s){if(deliveryBlock(s)){s.queueError=deliveryBlock(s);refreshConversation(s);return;}s.queueError='';if(s.interaction||conversationRuns.has(s.id)||s.archived||!s.queue?.length)return;const q=s.queue.shift();startConversationTurn(s,q.text,q.attachments);}
function finishConversation(s,status){const run=conversationRuns.get(s.id);if(!run)return;clearInterval(run.timer);conversationRuns.delete(s.id);run.message.status=status;if(status==='complete')run.message.kind=run.resultKind;save();refreshConversation(s);if(status!=='failed')drainQueue(s);}
function startConversationTurn(s,text,attachments=[],echo=true){
 if(echo)s.messages.push({role:'user',text,attachments:attachments.map(f=>f.name)});
 const message={role:'assistant',text:'',status:'running'};s.messages.push(message);
 let content=`正在整理「${text}」的相关信息。\n\n一、核对范围\n先确认设备、时间与现有记录，保留无法核实的信息。\n\n二、整理步骤\n逐项检查现场记录，汇总异常，再形成可复核的工作清单。\n\n三、交付结果\n这是本地逐段输出演示，不会访问业务系统或执行实际操作。你可以继续输入下一项任务，将它加入待发队列。`;
 const run={message,timer:null,steering:[],resultKind:/报告|周报|总结/.test(text)?'report':'analysis'};conversationRuns.set(s.id,run);save();refreshConversation(s);
 run.timer=setInterval(()=>{
  if(run.steering.length)content+='\n\n根据本轮补充要求继续处理：'+run.steering.splice(0).join('；');
  message.text=content.slice(0,message.text.length+7);save();
  if(conversationVisible(s)&&!s.openError){
   const area=$('#center-scroll'),follow=area&&area.scrollHeight-area.scrollTop-area.clientHeight<90;
   const p=$('.stream-text');if(p)p.textContent=message.text;
   if(follow)area.scrollTop=area.scrollHeight;
  }
  if(message.text.length===content.length)finishConversation(s,'complete');
 },160);
}
simulateReply=function(s,text){if(!conversationRuns.has(s.id))startConversationTurn(s,text,[],false);};
stopPending=function(){const s=current();if(s)finishConversation(s,'stopped');ui.pending=null;};
function cancelFirstSubmission(){if(!firstSubmission)return;clearTimeout(firstSubmission.timer);firstSubmission=null;renderApp();$('#prompt')?.focus();}
function deliverConversation(s,text,attachments){
 const blocked=deliveryBlock(s);if(blocked){s.sendError=blocked;save();refreshConversation(s);return;}
 if(nextLateFailure){nextLateFailure=false;ui.draft='';ui.attachments=[];rememberDraft();const failed={id:uid(),text,attachments};setTimeout(()=>{(s.failedSends??=[]).push(failed);save();refreshConversation(s);},2200);renderApp();return;}

 if(nextSendFailure){nextSendFailure=false;s.sendError='发送未成功，内容尚未投递。草稿已保留。';save();renderApp();return;}
 s.sendError='';ui.sendError='';ui.draft='';ui.attachments=[];rememberDraft();
 if(conversationRuns.has(s.id)||s.queue?.length){(s.queue??=[]).push({id:uid(),text,attachments});save();renderApp();}
 else startConversationTurn(s,text,attachments);
}
send=function(text){
 if(firstSubmission)return;
 if(modelBlocked||current()?.interaction||!['connected','restored'].includes(systemDemo.connection)){toast('当前无法发送，草稿已保留。');return;}
 if(systemDemo.mode==='loading'){toast('请等待加载完成。');return;}
 if(['empty','history'].includes(systemDemo.mode))resetSystemDemo();
 const submitted=(text??ui.draft).trim();if(!submitted){toast('请先输入任务内容。');return;}
 const attachments=[...ui.attachments];rememberDraft();
 if(current()){deliverConversation(current(),submitted,attachments);return;}
 const owner=state.workspace,op={timer:null};firstSubmission=op;renderApp();
 op.timer=setTimeout(()=>{
  if(firstSubmission!==op)return;
  if(state.workspace!==owner||!user){firstSubmission=null;renderApp();return;}
  firstSubmission=null;
  if(deliveryBlock()){ui.sendError=deliveryBlock();renderApp();return;}
  if(nextCreateFailure){nextCreateFailure=false;ui.sendError='创建会话失败，尚未创建新会话。草稿已保留。';renderApp();return;}
  const s={id:uid(),title:submitted.slice(0,22),messages:[],pinned:false,queue:[]};
  ws().sessions.unshift(s);ws().current=s.id;ui.mode='chat';conversationDrafts.delete(`${owner}/new`);
  if(ui.partialCreate){ui.partialCreate=false;s.attachError=true;rememberDraft();save();renderApp();return;}
  deliverConversation(s,submitted,attachments);
 },1500);
};
newChat=function(){rememberDraft();cancelFirstSubmission();ws().current=null;ui.mode='chat';restoreDraft();if(innerWidth<=700)ui.left=false;save();renderApp();$('#prompt')?.focus();};
function archiveConversation(id){const s=ws().sessions.find(s=>s.id===id);if(!s)return;const blocked=archiveBlock(s);if(blocked){toast(blocked);return;}if(managementFailure){managementFailure=false;$('#modal').insertAdjacentHTML('beforeend',conversationNotice('归档未成功，会话仍在列表中。请重试。'));return;}s.archived=true;s.pinned=false;if(ws().current===id){rememberDraft();ws().current=null;restoreDraft();}save();closeModal();renderApp();conversationScroll.delete(`${state.workspace}/${id}`);toast('会话已归档，消息仍保存在本机。');}

document.addEventListener('input',event=>{if(event.target.id==='prompt'){ui.draft=event.target.value;rememberDraft();}});
document.addEventListener('submit',event=>{
 if(event.target.getAttribute('id')==='workspace-form'){rememberDraft();cancelFirstSubmission();}
 if(event.target.getAttribute('id')==='queue-edit-form'){event.preventDefault();event.stopImmediatePropagation();const q=current()?.queue?.find(x=>x.id===event.target.elements.id.value);const text=event.target.elements.text.value.trim();if(!text){toast('任务内容不能为空。');return;}if(q)q.text=text;save();closeModal();renderApp();}
 if(event.target.getAttribute('id')==='rename-form'&&managementFailure){event.preventDefault();event.stopImmediatePropagation();managementFailure=false;event.target.insertAdjacentHTML('beforeend',conversationNotice('重命名未成功，原名称未改变。请重试。'));}
},true);
document.addEventListener('click',event=>{
 const b=event.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action,id=b.dataset.id,s=current();
 const handled=['failed-retry','select-session','project-session','stop','delete-session','archive-confirm','queue-edit','queue-remove','queue-steer','queue-fail','queue-resume','first-cancel','send-retry','model-restore','attach-retry','open-retry','card-retry','stream-fail','stream-bottom','conversation-scenario'];
 if(a==='choose-workspace'){rememberDraft();cancelFirstSubmission();state.workspace=id;restoreDraft();ui.mode='chat';save();closeModal();renderApp();event.stopImmediatePropagation();return;}
 if(!handled.includes(a))return;event.preventDefault();event.stopImmediatePropagation();
 if(a==='select-session'||a==='project-session'){rememberDraft();cancelFirstSubmission();ws().current=id;ui.mode='chat';restoreDraft();if(innerWidth<=700)ui.left=false;closeModal();save();renderApp();return;}
 if(a==='failed-retry'){const f=s.failedSends?.find(x=>x.id===id);if(!f)return;if(deliveryBlock(s)){toast(deliveryBlock(s));return;}s.failedSends=s.failedSends.filter(x=>x!==f);if(conversationRuns.has(s.id)||s.queue?.length)(s.queue??=[]).push(f);else startConversationTurn(s,f.text,f.attachments);save();renderApp();return;}
 if(a==='stop'){finishConversation(s,'stopped');toast('当前轮已结束；待发队列按顺序继续。');return;}
 if(a==='delete-session'){openModal('归档会话',`<p class="modal-intro">归档后会话从列表隐藏，消息仍保留。生成中、有待发任务或等待确认时，请先处理完成再归档。</p><div class="modal-actions"><button class="btn" data-action="close-modal">取消</button><button class="btn" data-action="archive-confirm" data-id="${id}">确认归档</button></div>`);return;}
 if(a==='archive-confirm'){archiveConversation(id);return;}
 if(a==='first-cancel'){cancelFirstSubmission();return;}
 if(a==='send-retry'){send();return;}
 if(a==='model-restore'){modelBlocked=false;renderApp();return;}
 if(a==='attach-retry'){s.attachError=false;save();renderApp();toast('已归入当前工作区，草稿尚未发送。');return;}
 if(a==='open-retry'){s.openError=false;renderApp();return;}
 if(a==='card-retry'){s.interaction.renderError=false;renderApp();$('#interaction-title')?.focus();return;}
 if(a==='stream-fail'){finishConversation(s,'failed');return;}
 if(a==='stream-bottom'){scrollChat();return;}
 if(a==='queue-fail'){queueFailure=true;toast('下一次队列操作将模拟失败。');return;}
 if(a==='queue-resume'){drainQueue(s);return;}
 if(a.startsWith('queue-')){if(queueFailure){queueFailure=false;s.queueError='队列操作未成功，原队列未改变。请重试。';renderApp();return;}s.queueError='';const q=s.queue?.find(x=>x.id===id);if(!q)return;if(a==='queue-steer'){steerQueued(s,id);return;}if(a==='queue-edit')textForm('编辑待发任务','任务内容',q.text,'queue-edit-form',`<input type="hidden" name="id" value="${id}">`);else{ s.queue=s.queue.filter(x=>x!==q);save();renderApp();}return;}
 if(a==='conversation-scenario'){
  resetSystemDemo();modelBlocked=false;nextLateFailure=false;nextSendFailure=false;nextCreateFailure=false;ui.partialCreate=false;closeModal();const scenario=b.dataset.scenario;
  if(scenario==='card-error'){startInteraction('approval');current().interaction.renderError=true;renderApp();return;}
  if(scenario==='manage-error'){managementFailure=true;toast('下一次归档或重命名将模拟失败，随后可重试。');return;}
  if(scenario==='model'){modelBlocked=true;renderApp();return;}
  if(scenario==='open-error'){if(!current()){ws().current=ws().sessions.find(x=>!x.archived)?.id;}if(current())current().openError=true;renderApp();return;}
  newChat();ui.draft='整理明日巡检安排';rememberDraft();
  if(scenario==='send-error')nextSendFailure=true;
  if(scenario==='late-error')nextLateFailure=true;
  if(scenario==='create-error')nextCreateFailure=true;
  if(scenario==='partial')ui.partialCreate=true;
  if(scenario==='stream'||scenario==='late-error'||scenario==='send-error'||scenario==='partial'||scenario==='create-error')send();else renderApp();
 }
},true);
// A reload ends local timers, but retains partial output instead of claiming it is still streaming.
for(const w of Object.values(state.workspaces))for(const s of w.sessions)for(const m of s.messages)if(m.status==='running')m.status='stopped';
render();
