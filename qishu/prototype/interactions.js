/* Local interaction requests belong to their session, independently of the visible card. */
'use strict';
const interactionBusy = new Set();
function interactionDemo(){
 openModal('工作台 · 交互演示',`<p class="modal-intro">选择一个场景体验。所有操作仅在本机模拟，不执行命令。</p>${systemDemoMenu()}<div class="modal-list">${[
 ['approval','shield','操作审批','查看命令与目标，允许一次或拒绝'],
 ['fallback','info','详情不可用','无法解析调用时的安全提示'],
 ['questions','chat','用户提问','单选、多选与补充说明，多题整体提交'],
 ['free','edit','自由回答','没有选项时，直接描述你的要求'],
 ['plan','file','方案确认','阅读方案，确认或退回修改'],
 ['approve-only','check','仅批准方案','请求只有一个批准选项']
 ].map(([key,ic,title,desc])=>`<button class="choice-row" data-action="interaction-start" data-scenario="${key}">${icon(ic)}<span><strong>${title}</strong><small>${desc}</small></span>${icon('next')}</button>`).join('')}</div>`);
}
function startInteraction(scenario){
 resetSystemDemo();
 stopPending();
 const approval=['approval','fallback'].includes(scenario),plan=['plan','approve-only'].includes(scenario);
 const r={key:uid(),kind:approval?'approval':plan?'plan-review':'question',error:'',drafts:{},invalid:[],failNext:false};
 if(approval){Object.assign(r,{toolName:'shell',reason:'将巡检安排导出到工作区',callId:scenario==='fallback'?null:'call-inspection-export',detail:scenario==='fallback'?null:{command:'python export_inspection.py --date 2026-09-17 --output ./exports/巡检安排.xlsx',target:'工作区 / exports / 巡检安排.xlsx',effect:'生成一份巡检安排文件；同名文件存在时会被覆盖。'}});}
 else if(plan){r.questions=[{id:'plan',header:'明日巡检方案',question:'请确认这份巡检安排',detail:'## 巡检目标\n复核二车间设备温度异常，形成待整改清单。\n## 执行步骤\n1. 09:00 核对 3 号泵的温度与运行记录。\n2. 10:00 检查消防通道与防护设施。\n3. 11:00 汇总发现，生成巡检报告草稿。\n## 交付范围\n仅生成计划与报告草稿，现场操作和对外发送另行确认。',options:scenario==='approve-only'?['按此方案继续']:['退回修改','按此方案继续'],intent:{approve:'按此方案继续',...(scenario==='plan'?{decline:'退回修改'}:{})}}];}
 else {r.questions=scenario==='free'?[{id:'requirements',header:'补充要求',question:'这次巡检还有哪些需要特别关注的事项？',detail:'请描述关注区域、交付形式或时间要求。'}]:[
 {id:'area',header:'巡检范围',question:'优先检查哪个区域？',detail:'选择一个区域，也可以直接填写其他范围。',options:['二车间','东侧仓库','全厂公共区域']},
 {id:'focus',header:'检查重点',question:'这次需要关注哪些内容？',detail:'可多选，并同时补充其他检查事项。',multiSelect:true,options:['设备温度','消防通道','人员防护']},
 {id:'notes',header:'交付要求',question:'希望巡检结果如何呈现？',detail:'例如：先给出异常摘要，再附上逐项检查表。'}];}
 const title=approval?'操作审批演示':plan?'巡检方案确认':'巡检需求确认';
 const s={id:uid(),title,pinned:false,messages:[{role:'user',text:'帮我准备明日巡检安排。'},{role:'assistant',text:approval?'导出之前，需要你确认这次操作。':plan?'我整理了下面的方案，请确认后继续。':'开始之前，想先和你确认几个细节。'}],interaction:r};
 ws().sessions.unshift(s);ws().current=s.id;ui.mode='chat';if(innerWidth<=700){ui.left=false;ui.right=false;}
 save();closeModal();renderApp();requestAnimationFrame(()=>$('#interaction-title')?.focus());
}
function planBody(text){
 return text.split('\n').map(line=>line.startsWith('## ')?`<h4>${esc(line.slice(3))}</h4>`:`<p>${esc(line)}</p>`).join('');
}
function interactionView(){
 const r=current()?.interaction;if(!r)return '';
 const busy=interactionBusy.has(r.key),disabled=busy?'disabled':'';
 let content='',actions='';
 if(r.kind==='approval'){
  content=`<h3 id="interaction-title" tabindex="-1">${esc(r.reason||r.toolName)}</h3><p class="interaction-description">奇术需要你的授权才能继续本次操作。</p><div class="interaction-detail" tabindex="0" role="group" aria-label="操作详情"><dl><dt>工具</dt><dd>${esc(r.toolName)}</dd>${r.detail?`<dt>目标</dt><dd>${esc(r.detail.target)}</dd><dt>影响</dt><dd>${esc(r.detail.effect)}</dd>`:''}</dl>${r.detail?`<pre><code>${esc(r.detail.command)}</code></pre>`:'<p>暂时无法获取调用详情，请确认操作意图后再授权；如有疑问，可以拒绝本次操作。</p>'}</div>`;
  actions=`<button class="btn interaction-reject" data-action="interaction-answer" data-answer="rejected" ${disabled}>拒绝</button><button class="btn primary" data-action="interaction-answer" data-answer="allowed-once" ${disabled}>允许一次 ${icon('arrow')}</button>`;
 }else if(r.kind==='plan-review'){
  const q=r.questions[0];
  content=`<h3 id="interaction-title" tabindex="-1">${esc(q.header)}</h3><p class="interaction-description">${esc(q.question)}</p><div class="interaction-detail plan-body" tabindex="0" role="group" aria-label="方案正文">${planBody(q.detail)}</div>`;
  actions=q.options.map(label=>`<button class="btn ${label===q.intent.approve?'primary':''}" data-action="interaction-answer" data-answer="${esc(label)}" ${disabled}>${esc(label)}</button>`).join('');
 }else{
  content=`<h3 id="interaction-title" tabindex="-1">补充细节，让安排更贴合你的需要</h3><p class="interaction-description">共 ${r.questions.length} 个问题 · 填写后一次提交</p>`+r.questions.map((q,i)=>{
   const a=r.drafts[q.id]||{selected:[],custom:''},invalid=r.invalid.includes(q.id),prefix=`iq-${q.id}`;
   return `<fieldset class="interaction-question" ${disabled} aria-describedby="${prefix}-detail ${prefix}-error"><legend>${i+1}. ${esc(q.header||q.question)}</legend><p>${esc(q.question)}</p><p class="question-detail" id="${prefix}-detail">${esc(q.detail||'')}</p><div class="interaction-options">${(q.options||[]).map((label,j)=>`<label class="interaction-option"><input type="${q.multiSelect?'checkbox':'radio'}" name="${prefix}" data-question="${q.id}" value="${esc(label)}" ${a.selected.includes(label)?'checked':''}><span>${esc(label)}</span></label>`).join('')}</div><label class="custom-label" for="${prefix}-custom">${q.options?'其他 / 补充说明':'你的回答'}</label><textarea id="${prefix}-custom" data-question="${q.id}" data-custom="true" rows="2" maxlength="2000" placeholder="${q.multiSelect?'可在已选项目之外补充…':'在这里填写…'}" aria-invalid="${invalid}" aria-describedby="${prefix}-detail ${prefix}-error">${esc(a.custom||'')}</textarea><p id="${prefix}-error" class="interaction-field-error" ${invalid?'':'hidden'}>请先回答这一题。</p></fieldset>`;
  }).join('');
  actions=`<button class="btn primary" data-action="interaction-submit" ${disabled}>提交回答 ${icon('arrow')}</button>`;
 }
 return `<section id="interaction-card" class="interaction-card" aria-labelledby="interaction-title" aria-busy="${busy}"><div class="interaction-eyebrow">${icon(r.kind==='approval'?'shield':r.kind==='plan-review'?'file':'chat')}<span>${busy?'正在提交…':r.kind==='approval'?'等待授权':r.kind==='plan-review'?'等待方案确认':'等待你的回答'}</span><span class="interaction-local">本地演示</span></div>${content}${r.error?`<p class="interaction-error" role="alert">${esc(r.error)}</p>`:''}<div class="interaction-actions"><span role="status">${busy?'提交中，请稍候':'确认后，奇术将继续处理'}</span><div>${actions}</div></div><details class="interaction-simulation"><summary>演示状态</summary><p>以下控件用于检查异常状态，不会向外部系统发送请求。</p><label><input type="checkbox" data-fail-next ${r.failNext?'checked':''} ${disabled}> 模拟下一次提交失败</label><button class="text-button" data-action="interaction-revoke">模拟请求方撤销</button></details></section>`;
}
function refreshInteraction(){const card=$('#interaction-card');if(card)card.outerHTML=interactionView();}
function captureInteraction(event){
 const t=event.target,r=current()?.interaction;if(!r||interactionBusy.has(r.key))return;
 if(t.hasAttribute('data-fail-next')){r.failNext=t.checked;save();return;}
 const q=r.questions?.find(q=>q.id===t.dataset.question);if(!q)return;
 const a=r.drafts[q.id]||(r.drafts[q.id]={selected:[],custom:''});
 if(t.dataset.custom){a.custom=t.value;if(!q.multiSelect&&a.custom.trim()){a.selected=[];document.querySelectorAll(`[name="iq-${q.id}"]`).forEach(input=>input.checked=false);}}
 else if(t.type==='radio'){a.selected=[t.value];a.custom='';$(`#iq-${q.id}-custom`).value='';}
 else if(t.type==='checkbox'){a.selected=[...document.querySelectorAll(`[name="iq-${q.id}"]:checked`)].map(input=>input.value);}
 r.invalid=r.invalid.filter(id=>id!==q.id);$(`#iq-${q.id}-error`).hidden=true;$(`#iq-${q.id}-custom`).setAttribute('aria-invalid','false');save();
}
function answerInteraction(value){
 const s=current(),r=s?.interaction;if(!r||interactionBusy.has(r.key))return;
 let answer=value;
 if(r.kind==='question'){
  r.invalid=r.questions.filter(q=>{const a=r.drafts[q.id];return !a||(!a.selected.length&&!a.custom.trim());}).map(q=>q.id);
  if(r.invalid.length){refreshInteraction();$(`#iq-${r.invalid[0]}-custom`).focus();return;}
  answer={answers:r.questions.map(q=>{const a=r.drafts[q.id];return {id:q.id,selected:a.selected,...(a.custom.trim()?{custom:a.custom.trim()}:{})};})};
 }else if(r.kind==='plan-review'){answer={answers:[{id:r.questions[0].id,selected:[value]}]};}
 interactionBusy.add(r.key);r.error='';refreshInteraction();
 setTimeout(()=>{
  interactionBusy.delete(r.key);if(s.interaction?.key!==r.key)return;
  const visible=user&&current()?.id===s.id;
  if(r.failNext){r.failNext=false;r.error='提交未成功，已保留你的选择。请重试。';save();if(visible){refreshInteraction();$('.interaction-error')?.setAttribute('tabindex','-1');$('.interaction-error')?.focus();}return;}
  s.interaction=null;s.interactionAnswers=[...(s.interactionAnswers||[]),{key:r.key,kind:r.kind,answer}];
  const rejected=r.kind==='approval'?value==='rejected':r.kind==='plan-review'&&value===r.questions[0].intent.decline;
  const text=r.kind==='approval'?(rejected?'你已拒绝本次操作。':'你已允许本次操作，仅限这一次。'):r.kind==='plan-review'?`你选择了「${value}」。`:answer.answers.map((a,i)=>`${i+1}. ${[...a.selected,a.custom].filter(Boolean).join('；')}`).join('\n');
  s.messages.push({role:'user',text},{role:'assistant',text:rejected?'已暂停该操作。你可以补充要求，我会调整后再与你确认。':'已收到确认，我将按你的要求继续。这里展示流程衔接，不执行真实命令或业务任务。'});
  save();if(visible){renderApp();scrollChat();$('#prompt')?.focus();}
 },800);
}
document.addEventListener('input',captureInteraction);
document.addEventListener('click',event=>{
 const b=event.target.closest('[data-action]');if(!b||b.disabled)return;
 switch(b.dataset.action){
  case 'interaction-demo':interactionDemo();break;
  case 'interaction-start':startInteraction(b.dataset.scenario);break;
  case 'interaction-answer':answerInteraction(b.dataset.answer);break;
  case 'interaction-submit':answerInteraction();break;
  case 'interaction-revoke':{const s=current();if(!s?.interaction)return;interactionBusy.delete(s.interaction.key);s.interaction=null;save();renderApp();toast('请求方已撤销该请求，未记录为拒绝。');$('#prompt')?.focus();break;}
 }
});
