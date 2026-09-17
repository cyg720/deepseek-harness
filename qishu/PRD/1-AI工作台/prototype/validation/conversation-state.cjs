/* Deterministic lifecycle checks; DOM presentation is checked separately in the browser. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../conversation-demo.js'),'utf8');
function harness(){
 let id=0;const timers=new Map(),listeners={};
 const context=vm.createContext({
  state:{workspace:'a',workspaces:{a:{current:null,sessions:[]}}},ui:{draft:'',attachments:[],mode:'chat'},user:{name:'test'},innerWidth:1440,
  renderApp(){},render(){},interactionView(){return '';},systemDemoMenu(){return '';},startInteraction(){},simulateReply(){},stopPending(){},send(){},newChat(){},
  document:{activeElement:null,addEventListener(name,fn){(listeners[name]??=[]).push(fn);}},
  $(){return null;},save(){},toast(){},closeModal(){},resetSystemDemo(){},systemDemo:{mode:'',connection:'connected'},
  setTimeout(fn){const key=++id;timers.set(key,()=>{timers.delete(key);fn();});return key;},clearTimeout(key){timers.delete(key);},
  setInterval(fn){const key=++id;timers.set(key,fn);return key;},clearInterval(key){timers.delete(key);},uid(){return String(++id);}
 });
 vm.runInContext('function ws(){return state.workspaces[state.workspace]} function current(){return ws().sessions.find(s=>s.id===ws().current)}',context);
 vm.runInContext(source,context);
 return {run(code){return vm.runInContext(code,context);},tick(){for(const fn of [...timers.values()])fn();}};
}
test('cancelled first submission never creates a session and retains text',()=>{
 const h=harness();h.run("ui.draft='keep';send();cancelFirstSubmission()");h.tick();assert.equal(h.run('ws().sessions.length'),0);assert.equal(h.run('ui.draft'),'keep');
});
test('first send freezes its text rather than using a later draft',()=>{
 const h=harness();h.run("ui.draft='first';send();ui.draft='changed'");h.tick();assert.equal(h.run('current().messages[0].text'),'first');
});
test('creation failure retains draft and a retry creates only one session',()=>{
 const h=harness();h.run("ui.draft='retry';nextCreateFailure=true;send()");h.tick();assert.equal(h.run('ws().sessions.length'),0);assert.equal(h.run('ui.draft'),'retry');h.run('send()');h.tick();assert.equal(h.run('ws().sessions.length'),1);
});
test('failed admission retains created session and retry does not duplicate it',()=>{
 const h=harness();h.run("ui.draft='retry';nextSendFailure=true;send()");h.tick();assert.equal(h.run('current().messages.length'),0);assert.equal(h.run('ui.draft'),'retry');h.run('send()');assert.equal(h.run('ws().sessions.length'),1);assert.equal(h.run('current().messages.length'),2);
});
test('stopping a turn preserves partial output and starts queued work in order',()=>{
 const h=harness();h.run("ui.draft='first';send()");h.tick();h.tick();h.run("ui.draft='second';send();finishConversation(current(),'stopped')");assert.equal(h.run('current().messages[1].status'),'stopped');assert.ok(h.run('current().messages[1].text.length')>0);assert.equal(h.run('current().messages[2].text'),'second');assert.equal(h.run('current().queue.length'),0);
});
test('navigation preserves running session and isolates unsent drafts',()=>{
 const h=harness();h.run("ui.draft='first';send()");h.tick();h.run("ui.draft='draft A';rememberDraft();const oldId=current().id;newChat();ui.draft='draft B';rememberDraft();ws().current=oldId;restoreDraft()");assert.equal(h.run('ui.draft'),'draft A');assert.equal(h.run('conversationRuns.has(current().id)'),true);h.tick();assert.ok(h.run('current().messages[1].text.length')>0);
});
test('archiving retains messages and removes the current selection',()=>{
 const h=harness();h.run("ui.draft='first';send()");h.tick();h.run("finishConversation(current(),'stopped');archiveConversation(current().id)");assert.equal(h.run('ws().sessions[0].archived'),true);assert.equal(h.run('ws().sessions[0].messages.length'),2);assert.equal(h.run('ws().current'),null);
});
test('new submission cannot overtake an existing paused queue',()=>{
 const h=harness();h.run("ui.draft='first';send()");h.tick();h.run("ui.draft='second';send();finishConversation(current(),'failed');ui.draft='third';send()");assert.equal(h.run('current().queue.map(q=>q.text).join()'),'second,third');assert.equal(h.run('conversationRuns.size'),0);h.run('drainQueue(current())');assert.equal(h.run('current().messages[2].text'),'second');
});

test('first submission rechecks connectivity before creating or sending',()=>{
 const h=harness();h.run("ui.draft='keep';send();systemDemo.connection='disconnected'");h.tick();assert.equal(h.run('ws().sessions.length'),0);assert.equal(h.run('ui.draft'),'keep');assert.equal(h.run('firstSubmission'),null);
});
test('paused queue survives offline and model blocks',()=>{
 const h=harness();h.run("ui.draft='first';send()");h.tick();h.run("ui.draft='second';send();finishConversation(current(),'failed');systemDemo.connection='disconnected';drainQueue(current())");assert.equal(h.run('current().queue.length'),1);h.run("systemDemo.connection='connected';modelBlocked=true;drainQueue(current())");assert.equal(h.run('conversationRuns.size'),0);h.run('modelBlocked=false;drainQueue(current())');assert.equal(h.run('current().queue.length'),0);
});
test('late failure preserves a newer draft in its session',()=>{
 const h=harness();h.run("ui.draft='first';send()");h.tick();h.run("nextLateFailure=true;ui.draft='failed A';send();ui.draft='new B';rememberDraft()");h.tick();assert.equal(h.run('ui.draft'),'new B');assert.equal(h.run('current().failedSends[0].text'),'failed A');
});
test('steering joins the running turn instead of reordering the queue',()=>{
 const h=harness();h.run("ui.draft='first';send()");h.tick();h.run("ui.draft='second';send();steerQueued(current(),current().queue[0].id)");assert.equal(h.run('current().queue.length'),0);assert.equal(h.run('conversationRuns.get(current().id).steering[0]'),'second');assert.equal(h.run('current().messages.filter(x=>x.role==="assistant").length'),1);
});
test('steering after the turn ends preserves the queued task',()=>{
 const h=harness();h.run("ui.draft='first';send()");h.tick();h.run("ui.draft='second';send();finishConversation(current(),'failed');steerQueued(current(),current().queue[0].id)");assert.equal(h.run('current().queue.length'),1);assert.ok(h.run('current().queueError'));
});
test('active, queued and pending sessions cannot be archived',()=>{
 const h=harness();h.run("ui.draft='first';send()");h.tick();h.run('archiveConversation(current().id)');assert.equal(h.run('!!current().archived'),false);h.run("ui.draft='second';send();finishConversation(current(),'failed');archiveConversation(current().id)");assert.equal(h.run('!!current().archived'),false);h.run("current().queue=[];current().interaction={key:'pending'};archiveConversation(current().id)");assert.equal(h.run('!!current().archived'),false);
});
test('scroll positions and follow intent are isolated by rendered session key',()=>{
 const h=harness();h.run("let area={scrollTop:120,scrollHeight:1000,clientHeight:300};$=q=>q==='#center-scroll'?area:null;renderedConversationKey='a/A';rememberScroll();renderedConversationKey='a/B';area.scrollTop=700;rememberScroll()");assert.equal(h.run("conversationScroll.get('a/A').top"),120);assert.equal(h.run("conversationScroll.get('a/A').follow"),false);assert.equal(h.run("conversationScroll.get('a/B').follow"),true);
});

test('queue markup disables steering without an active turn',()=>{
 const h=harness();h.run("esc=String;ui.draft='first';send()");h.tick();h.run("ui.draft='queued';send()");assert.match(h.run('queueView(current())'),/引导当前轮/);assert.doesNotMatch(h.run('queueView(current())'),/data-action="queue-steer"[^>]*disabled/);h.run("finishConversation(current(),'failed')");assert.match(h.run('queueView(current())'),/data-action="queue-steer"[^>]*disabled/);
});
test('model change during first creation preserves input and unfreezes',()=>{
 const h=harness();h.run("ui.draft='keep';send();modelBlocked=true");h.tick();assert.equal(h.run('ws().sessions.length'),0);assert.equal(h.run('ui.draft'),'keep');assert.equal(h.run('firstSubmission'),null);
});
