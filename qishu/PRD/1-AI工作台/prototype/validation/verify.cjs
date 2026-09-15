/* Browser acceptance of the standalone prototype; uses an isolated context. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const base=process.env.PROTOTYPE_URL||'http://127.0.0.1:4173';
const out=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});
 const page=await context.newPage();const errors=[];const checks=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 page.on('pageerror',e=>errors.push(e.message));
 const act=async(name,scope=page)=>scope.locator(`[data-action="${name}"]`).first().click();
 const modal=page.locator('#modal');
 const close=()=>act('close-modal',modal);
 const ok=label=>{checks.push(label);console.log('PASS '+label);};
 const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('yuvi-prototype-v1')));
 const noOverflow=async p=>assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const ready=()=>page.waitForFunction(()=>!document.querySelector('.pending'));
 await fs.mkdir(path.join(out,'preview'),{recursive:true});
 try{
 await page.goto(base);await page.waitForLoadState('networkidle');
 await page.screenshot({path:path.join(out,'preview/login-desktop.png'),fullPage:true});
 await page.locator('#login-form button[type="submit"]').click();
 assert.match(await page.locator('#login-error').innerText(),/请输入/);
 await page.locator('#username').fill('invalid');await page.locator('#password').fill('invalid');
 await page.locator('#login-form button[type="submit"]').click();
 assert.match(await page.locator('#login-error').innerText(),/不正确/);
 await act('toggle-password');assert.equal(await page.locator('#password').getAttribute('type'),'text');await act('toggle-password');
 await act('password-help');assert.match(await modal.innerText(),/重置/);await close();
 await act('help');assert.match(await modal.innerText(),/原型范围/);await page.keyboard.press('Escape');
 await act('fill-demo');await page.locator('#remember').check();await page.locator('#login-form button[type="submit"]').click();
 assert.equal(await page.locator('.app').count(),1);assert.equal((await stored()).rememberUser.username,'admin');
 assert.equal(JSON.stringify(await stored()).includes('Demo@2026'),false);
 await noOverflow(page);await page.locator('#toast').evaluate(e=>e.classList.remove('visible'));
 await page.screenshot({path:path.join(out,'preview/home-desktop.png'),fullPage:true});
 ok('Login required/invalid credentials, password visibility, help, demo identity and password-free persistence');

 await act('toggle-left');assert.equal(await page.locator('.sidebar').getAttribute('inert'),'');await act('toggle-left');
 await act('toggle-right');assert.equal(await page.locator('.right-panel').getAttribute('inert'),'');await act('toggle-right');
 await act('switch-mode');await modal.locator('[data-mode="overview"]').click();assert.equal(await page.locator('.overview-card').count(),4);
 await act('show-todos');assert.equal(await page.locator('[data-tab="todos"]').getAttribute('aria-selected'),'true');await act('chat-mode');
 await act('workspaces');await modal.locator('[data-id="w2"]').click();assert.match(await page.locator('.workspace-name').innerText(),/东侧仓库/);
 assert.equal(await page.locator('.session-row').count(),2);
 await act('workspaces');await act('workspace-new',modal);await page.locator('#edit-text').fill('验收工作区');await modal.locator('button[type="submit"]').click();
 assert.equal(await page.locator('.session-row').count(),0);assert.equal(await page.locator('.file-row').count(),0);
 await act('workspaces');await modal.locator('[data-id="w1"]').click();assert.equal(await page.locator('.session-row').count(),5);
 ok('Both panels, overview mode, workspace switching and isolated new workspace');

 await page.locator('.session-link').first().click();
 await page.screenshot({path:path.join(out,'preview/chat-desktop.png'),fullPage:true,animations:'disabled'});
 await page.locator('.session-row').first().hover();await act('session-menu');
 await act('rename-session',modal);await page.locator('#edit-text').fill('测试会话 - 设备复核');await modal.locator('button[type="submit"]').click();
 assert.match(await page.locator('.session-link').first().innerText(),/测试会话/);
 await page.locator('.session-row').first().hover();await act('session-menu');await act('pin-session',modal);
 assert.equal((await stored()).workspaces.w1.sessions[0].pinned,false);
 await page.locator('.session-row').first().hover();await act('session-menu');await act('pin-session',modal);
 await page.locator('.session-row').first().hover();await act('session-menu');
 const exported=page.waitForEvent('download');await act('export-session',modal);assert.match((await exported).suggestedFilename(),/测试会话/);await close();
 await act('new-chat');await page.locator('#prompt').fill('检查设备状态');await page.locator('#model').selectOption('DeepSeek R1');await act('thinking');
 await page.locator('#file-input').setInputFiles({name:'context.txt',mimeType:'text/plain',buffer:Buffer.from('device context')});
 assert.equal(await page.locator('.attachment').count(),1);await act('remove-attachment');assert.equal(await page.locator('.attachment').count(),0);
 await act('voice');await modal.locator('[data-action="voice-transcript"]').first().click();assert.match(await page.locator('#prompt').inputValue(),/设备/);
 await page.locator('#prompt').fill('查看设备温度');await page.locator('#prompt').press('Enter');await ready();
 assert.equal(await page.locator('.message.user').count(),1);assert.equal(await page.locator('.message.assistant').count(),1);
 assert.equal(await page.locator('.result-card').count(),1);await act('like-message');assert.equal(await page.locator('[data-action="like-message"]').getAttribute('aria-pressed'),'true');
 await act('result-details');assert.match(await modal.innerText(),/86°C/);await close();
 const summary=page.waitForEvent('download');await act('export-report');assert.match((await summary).suggestedFilename(),/摘要/);
 await act('copy-message');if(await modal.evaluate(e=>e.open))await close();
 await act('retry-message');await ready();assert.equal(await page.locator('.message.assistant').count(),2);
 await page.locator('#prompt').fill('继续排查');await act('send');await act('stop');assert.match(await page.locator('.message.assistant').last().innerText(),/停止生成/);
 ok('Session rename/pin/export, composer/model/thinking/attachment/voice, reply/stop/retry/copy/feedback/evidence/download');

 await page.locator('[data-action="task-draft"]').first().click();await page.locator('#todo-title').fill('验收：现场复核');await modal.locator('button[type="submit"]').click();
 assert.equal(await page.locator('[data-tab="todos"]').getAttribute('aria-selected'),'true');
 await page.locator('.todo-item').first().locator('input').check();assert.match(await page.locator('.todo-item').first().getAttribute('class'),/done/);
 await page.locator('.todo-item').first().locator('[data-action="todo-edit"]').click();await page.locator('#todo-title').fill('验收：已修改复核');await modal.locator('button[type="submit"]').click();
 assert.match(await page.locator('.todo-item').first().innerText(),/已修改/);
 await page.locator('.todo-item').first().locator('[data-action="todo-delete"]').click();await close();assert.match(await page.locator('.todo-item').first().innerText(),/已修改/);
 await page.locator('.todo-item').first().locator('[data-action="todo-delete"]').click();await act('confirm-delete-todo',modal);
 assert.equal(await page.getByText('验收：已修改复核',{exact:true}).count(),0);
 await page.locator('[data-tab="calendar"]').click();await act('month-next');assert.match(await page.locator('.calendar-head').innerText(),/10 月/);await act('month-prev');
 await page.locator('[data-date="2026-09-15"]').click();await act('event-new');await page.locator('#event-title').fill('验收巡检');await page.locator('#event-place').fill('二车间');await modal.locator('button[type="submit"]').click();
 assert.match(await page.locator('.event-row').innerText(),/验收巡检/);await act('event-edit');await page.locator('#event-title').fill('修改后的巡检');await modal.locator('button[type="submit"]').click();
 await act('event-delete');await act('confirm-delete-event',modal);assert.equal(await page.locator('.event-row').count(),0);
 await act('calendar-today');assert.equal(await page.locator('.event-row').count(),2);
 ok('Result-to-todo creation, todo complete/edit/cancel/delete, calendar navigation/date/event CRUD');

 await page.locator('[data-tab="workspace"]').click();
 await act('project-new');await page.locator('#edit-text').fill('验收项目');await modal.locator('button[type="submit"]').click();assert.match(await page.locator('.project-top').innerText(),/验收项目/);
 await act('project-detail');await act('project-rename',modal);await page.locator('#edit-text').fill('安全生产日常管理');await modal.locator('button[type="submit"]').click();
 await page.locator('[data-action="upload"][data-target="workspace"]').first().click();
 await page.locator('#file-input').setInputFiles({name:'验收资料.txt',mimeType:'text/plain',buffer:Buffer.from('本次现场巡检：无可见泄漏。')});
 await page.locator('.file-row').last().locator('[data-action="file-preview"]').click();await modal.locator('pre').waitFor();assert.match(await modal.innerText(),/无可见泄漏/);
 const file=page.waitForEvent('download');await act('download-file',modal);assert.equal((await file).suggestedFilename(),'验收资料.txt');
 await act('reference-file',modal);assert.equal(await page.locator('.attachment').count(),1);await act('remove-attachment');
 await page.locator('.file-row').last().hover();await page.locator('.file-row').last().locator('[data-action="delete-file"]').click();await act('confirm-delete-file',modal);assert.equal(await page.locator('.file-row').count(),3);
 ok('Project naming/detail, workspace upload/text preview/download/reference/delete');

 for(const category of ['agents','plugins','rag','skills','apps','terminals']){
  await page.locator(`.tool-link[data-category="${category}"]`).click();
  await page.locator('#catalog-search').fill('no-matches');assert.equal(await page.locator('#catalog-empty').isVisible(),true);
  await page.locator('#catalog-search').fill('');await modal.locator('[data-action="app-detail"]').first().click();
  if(category==='plugins'){await act('toggle-plugin',modal);assert.match(await modal.innerText(),/已启用/);await act('toggle-plugin',modal);assert.match(await modal.innerText(),/未启用/);await close();}
  else if(category==='terminals'){await act('terminal-config',modal);await page.locator('#terminal-label').fill('测试协作群');await modal.locator('button[type="submit"]').click();assert.match(await modal.innerText(),/已启用/);await act('terminal-config',modal);await act('disconnect-terminal',modal);assert.match(await modal.innerText(),/未启用/);await close();}
  else{await act('use-app',modal);assert.match(await page.locator('#prompt').inputValue(),/请使用/);}
 }
 await page.locator('.recent-app').first().click();assert.equal(await modal.evaluate(e=>e.open),true);await close();
 ok('All six capability catalogs, search/no-match, details, use in chat, plugin toggle and terminal configuration/disconnect');

 await act('settings');await page.locator('#setting-theme').selectOption('dark');await page.locator('#setting-compact').check();await page.locator('#setting-enter').uncheck();await act('save-settings',modal);
 assert.match(await page.locator('body').getAttribute('class'),/dark/);
 await page.locator('#toast').evaluate(e=>e.classList.remove('visible'));await page.screenshot({path:path.join(out,'preview/home-dark.png'),fullPage:true});
 await page.locator('#prompt').fill('换行测试');await page.locator('#prompt').press('Enter');assert.match(await page.locator('#prompt').inputValue(),/\n/);
 await act('settings');await page.locator('#setting-theme').selectOption('light');await page.locator('#setting-compact').uncheck();await page.locator('#setting-enter').check();await act('save-settings',modal);
 await page.keyboard.press('Control+k');assert.equal(await page.locator('#prompt').inputValue(),'');
 await page.reload();assert.equal(await page.locator('.app').count(),1);assert.equal((await stored()).workspaces.w1.project,'安全生产日常管理');
 const remembered=await context.newPage();await remembered.goto(base);assert.equal(await remembered.locator('.app').count(),1);await remembered.close();
 await act('profile');await act('logout',modal);assert.equal(await page.locator('#login-form').count(),1);assert.equal((await stored()).rememberUser,null);
 ok('Theme/compact/input preferences, keyboard shortcut, refresh persistence, automatic login and logout');

 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const mp=await mobile.newPage();mp.on('pageerror',e=>errors.push(e.message));
 await mp.goto(base);await noOverflow(mp);await mp.screenshot({path:path.join(out,'preview/login-mobile.png'),fullPage:true});
 await act('fill-demo',mp);await mp.locator('#login-form button[type="submit"]').click();await noOverflow(mp);
 await mp.locator('#toast').evaluate(e=>e.classList.remove('visible'));await mp.screenshot({path:path.join(out,'preview/home-mobile.png'),fullPage:true});
 await act('toggle-left',mp);assert.equal(await mp.locator('.sidebar').getAttribute('inert'),null);await mp.locator('[data-action="dismiss-panels"]').click({position:{x:375,y:100}});
 await act('toggle-right',mp);await mp.locator('[data-tab="todos"]').click();await act('todo-new',mp);await mp.locator('#todo-title').fill('手机待办');await mp.locator('#modal button[type="submit"]').click();assert.match(await mp.locator('.todo-item').first().innerText(),/手机待办/);
 await mp.locator('[data-action="dismiss-panels"]').click({position:{x:10,y:100}});await mp.locator('#prompt').fill('检查设备');await act('send',mp);await mp.waitForFunction(()=>!document.querySelector('.pending'));await noOverflow(mp);
 await mobile.close();ok('390px mobile login, home, navigation overlays, modal form and conversation');

 const offline=await browser.newContext({viewport:{width:1280,height:800}});const fp=await offline.newPage();fp.on('pageerror',e=>errors.push(e.message));await fp.goto(pathToFileURL(path.join(out,'index.html')).href);
 await act('fill-demo',fp);await fp.locator('#login-form button[type="submit"]').click();assert.equal(await fp.locator('.app').count(),1);await noOverflow(fp);await offline.close();
 ok('Direct file opening without a server');
 assert.deepEqual(errors,[]);ok('No uncaught browser errors');
 await fs.writeFile(path.join(__dirname,'report.json'),JSON.stringify({status:'passed',checkedAt:new Date().toISOString(),viewport:[1440,960],checks,errors,screenshots:['login-desktop.png','home-desktop.png','chat-desktop.png','home-dark.png','login-mobile.png','home-mobile.png']},null,2)+'\n');
 }catch(e){await page.screenshot({path:path.join(__dirname,'failure.png'),fullPage:true});await fs.writeFile(path.join(__dirname,'report.json'),JSON.stringify({status:'failed',checks,errors,error:String(e)},null,2)+'\n');throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
