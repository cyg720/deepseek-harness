/** Verify the offline matrix's navigation, evidence, imports and responsive layout. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},offline:true});
 const page=await context.newPage(), errors=[],network=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
 const tab=async view=>page.locator(`[data-mx="view"][data-value="${view}"]`).click();
 const shot=async name=>{await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(__dirname,`preview-matrix-${name}.png`),fullPage:true,animations:'disabled'});};
 await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href+'#matrix');
 await page.waitForFunction(()=>window.atlasReady===true,{timeout:120000});
 check('nine subsystem groups',await page.locator('[data-area-node="true"]').count()===9);
 const inventory=await page.evaluate(()=>({packages:D.packages.length,covered:new Set(D.matrix.areas.flatMap(a=>a.packages)).size,services:D.matrix.services.length,events:D.matrix.events.length,edges:D.matrix.edges.length,profiles:D.matrix.profiles.length}));
 check('all source packages covered',inventory.packages===307&&inventory.covered===307);
 check('documented evidence extracted',inventory.services>40&&inventory.events>40&&inventory.edges>500&&inventory.profiles===6);
 await shot('space');
 const before=await page.locator('#mx-map-svg').innerHTML();
 await page.locator('[data-mx="mode"][data-value="flat"]').click();
 check('flat projection changes geometry',before!==await page.locator('#mx-map-svg').innerHTML());
 await page.locator('[data-mx="mode"][data-value="spatial"]').click();
 await page.locator('[data-mx-node="agent"]').focus();await page.keyboard.press('Enter');
 check('keyboard expands package group',await page.locator('[data-area-node="false"]').count()>0);
 await page.locator('[data-mx-node="@deepseek-ai/dsh-agent-loop"]').click();
 check('node inspector exposes service evidence',(await page.locator('#mx-inspector').innerText()).includes('ctx.'));
 await page.locator('[data-mx="areas"]').click();await page.locator('#mx-search').fill('ctx.tools');await page.waitForTimeout(300);
 check('service search reaches packages',await page.locator('.mx-result').count()>0);
 await page.locator('#mx-search').fill('agent/pre-step');await page.waitForTimeout(300);
 check('event search reaches packages',await page.locator('.mx-result').count()>0);
 await page.locator('#mx-search').fill('no-such-package-12345');await page.waitForTimeout(300);
 check('empty search clears previous results',await page.locator('.mx-result').count()===0&&await page.locator('[data-mx-node]').count()===0);
 await page.locator('[data-mx="areas"]').click();await page.locator('[data-mx="locate-matrix"]').click();
 check('relationship matrix contains selectable evidence',await page.locator('.mx-cell').count()>0);
 await page.locator('.mx-cell').first().click();check('matrix evidence links to embedded source',await page.locator('#mx-cell-proof [data-file]').count()>0);
 await page.locator('[data-mx="matrix-page"]').last().click();
 check('selected node pinned across neighbor pages',(await page.locator('.mx-table tbody tr th').first().innerText()).includes('agent-loop'));
 await page.locator('#mx-relation').selectOption('service');check('service relationship cells',await page.locator('.mx-cell').count()>0);
 await page.locator('#mx-relation').selectOption('event');check('event relationship cells',await page.locator('.mx-cell').count()>0);await shot('table');
 await tab('profiles');check('web desktop share bundle references',(await page.locator('.mx-comparison b').allTextContents()).filter(x=>x==='0').length===2);
 await page.locator('#mx-profile-right').selectOption('headless');check('headless differs from web',(await page.locator('.mx-comparison b').allTextContents()).some((x,i)=>i!==1&&Number(x)>0));
 await page.locator('#mx-profile-left').selectOption('sdk-minimal');check('minimal SDK has independent bundle',await page.locator('.mx-profile-card').first().locator('.mx-stack-row').count()===1);
 await page.locator('#mx-profile-left').selectOption('web');
 for(const filter of ['disabled','conditional','deferred']){await page.locator('#mx-row-filter').selectOption(filter);check('configuration filter '+filter,await page.locator('.mx-config-row').count()>0);}
 await tab('flow');check('six guided scenes',await page.locator('[data-mx="scene"]').count()===6);
 for(const scene of ['chat','read','approval','cancel','restore','subagent']){
  await page.locator(`[data-mx="scene"][data-value="${scene}"]`).click();
  await page.locator('[data-mx="step"]').last().click();check(scene+' advances with source anchor',await page.locator('.mx-inspector [data-file]').count()===1&&await page.locator('#mx-step-range').inputValue()==='1');
 }
 await page.locator('[data-mx="scene"][data-value="chat"]').click();await page.locator('[data-mx="mark-step"]').click();check('learning progress saved',(await page.locator('[data-mx="mark-step"]').innerText()).includes('已读'));
 await page.locator('.question summary').click();check('beginner question expands',await page.locator('.question').evaluate(e=>e.open));
 await page.locator('.mx-inspector [data-file]').click();check('scene source opens at anchor',await page.locator('.code-line.highlight').count()===1);await page.locator('[data-close="detail"]').click();
 await page.locator('#mx-speed').selectOption('1800');await page.locator('[data-mx="play-scene"]').click();await page.waitForTimeout(2000);check('animation advances teaching step',await page.locator('#mx-step-range').inputValue()==='1');
 await tab('replay');check('leaving scene stops timer',await page.evaluate(()=>MX.playing===null));
 check('sample visibly synthetic',(await page.locator('#mx-content').innerText()).includes('教学示例 · 非真实日志'));
 const upload=async text=>{await page.locator('#mx-record-file').setInputFiles({name:'example.jsonl',mimeType:'text/plain',buffer:Buffer.from(text)});await page.waitForTimeout(150);};
 const valid=[{type:'session',version:4,id:'local-inspect'}, {seq:0,time:100,type:'user/message',data:{content:'<img src=x onerror=alert(1)>'}},{seq:1,time:120,type:'custom/event',data:{note:'unknown'}}];
 await upload(valid.map(x=>JSON.stringify(x)).join('\n'));check('local JSONL import',await page.locator('.mx-event-row').count()===2);check('record data displayed as text',(await page.locator('.mx-raw').innerText()).includes('<img')&&await page.locator('.mx-raw img').count()===0);
 await page.locator('[data-mx="replay-seq"][data-value="1"]').click();check('unknown event retained',(await page.locator('.mx-inspector').innerText()).includes('未解释'));
 for(const [name,text] of [['invalid JSON','{bad'],['duplicate seq',JSON.stringify([valid[1],valid[1]])],['unsupported version',JSON.stringify({header:{version:99,id:'old'},events:[valid[1]]})]]){await upload(text);check(name+' rejected without replacing record',await page.locator('[role="alert"]').count()===1&&await page.locator('.mx-event-row').count()===2);}
 await page.locator('[data-mx="sample"]').click();
 const downloadPromise=page.waitForEvent('download');await page.locator('[data-mx="export-progress"]').click();const download=await downloadPromise;const exported=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
 check('progress export excludes session content',exported.learned.includes('chat:0')&&!exported.events);
 await page.locator('#mx-progress-file').setInputFiles({name:'progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exported,learned:['chat:1']}))});await page.waitForTimeout(150);
 check('progress import merges known steps',await page.evaluate(()=>matrixLearned.includes('chat:0')&&matrixLearned.includes('chat:1')));
 check('invalid progress rejects unknown step',await page.evaluate(()=>{try{mxImportProgress(JSON.stringify({format:'qishu-learning-progress',version:1,learned:['bad:0'],bookmarks:[],seen:[]}));return false;}catch{return !matrixLearned.includes('bad:0');}}));
 for(const width of [390,1440,1920]){await page.setViewportSize({width,height:1000});for(const view of ['map','relations','profiles','flow','replay']){await tab(view);check(`no page overflow ${width} ${view}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}}
 await page.setViewportSize({width:1440,height:1000});await tab('flow');
 await page.locator('#theme').click();check('matrix supports dark theme',await page.evaluate(()=>document.documentElement.dataset.theme==='dark'));await shot('dark');await page.locator('#theme').click();
 await page.locator('#motion').click();check('reduced motion stops flow trace animation',await page.locator('.mx-trace-line').first().evaluate(e=>getComputedStyle(e).animationName==='none'));await page.locator('#motion').click();
 await page.waitForTimeout(2600);await shot('flow');
 check('no browser exceptions',errors.length===0);check('no external requests',network.length===0);
 fs.writeFileSync(path.join(__dirname,'verification-matrix.json'),JSON.stringify({verifiedAt:new Date().toISOString(),inventory,checks,errors,network},null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,inventory,errors,network}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
