/* 第二优先原型验收：隔离浏览器存储，证明原工作台入口和新增状态均可使用。 */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let states=0;try{
await page.goto('http://127.0.0.1:4173');await page.locator('[data-action=fill-demo]').click();await page.locator('#login-form button[type=submit]').click();
await page.locator('#prompt').fill('保留这条草稿');await page.locator('#toast').evaluate(e=>e.classList.remove('visible'));await page.locator('[data-action=interaction-demo]').click();await page.locator('[data-p2-open=tool]').click();
for(const width of [390,1440])for(const theme of ['light','dark']){
await page.setViewportSize({width,height:960});await page.waitForFunction(()=>layoutMode===viewportMode());await page.evaluate(t=>{state.settings.theme=t;renderApp();},theme);
for(const group of ['tool','process','retry','history','queue','pressure','command']){
await page.locator('#p2-group').selectOption(group);const modes=await page.locator('#p2-mode option').allTextContents();for(const mode of modes){await page.locator('#p2-mode').selectOption(mode);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,group+' '+mode);states++;}
await page.locator('#p2-mode').selectOption(modes[0]);await page.screenshot({path:path.join(__dirname,`../preview/second-priority-${group}-${width}-${theme}.png`)});
}}
await page.locator('#p2-group').selectOption('command');await page.locator('#p2-command').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#modal').evaluate(e=>e.open),true);await page.locator('[data-p2=cancel]').click();assert.equal(await page.locator('#p2-command').inputValue(),'/');assert.equal(await page.locator('#p2-command').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Enter');await page.locator('[data-p2=confirm]').click();assert.match(await page.locator('#p2-status').innerText(),/失败/);await page.keyboard.press('Escape');assert.equal(await page.locator('#p2-command').getAttribute('aria-expanded'),'false');
await page.locator('#p2-mode').selectOption('目录失败');await page.locator('[data-p2=catalog-retry]').click();assert.equal(await page.locator('[role=option]').count(),4);
await page.locator('#p2-command').dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(await page.locator('#modal').evaluate(e=>e.open),false);
await page.locator('#p2-group').selectOption('history');const before=await page.locator('#p2-anchor').boundingBox();await page.locator('[data-p2=load]').evaluate(e=>e.click());const after=await page.locator('#p2-anchor').boundingBox();assert.ok(Math.abs(before.y-after.y)<2,'历史前插保留锚点');
await page.locator('#p2-group').selectOption('tool');await page.locator('#p2-mode').selectOption('未知媒体');assert.equal(await page.locator('.p2-content img').count(),0);
await page.locator('[data-p2=exit]').click();assert.equal(await page.locator('#prompt').inputValue(),'保留这条草稿');assert.equal(await page.locator('.p2-bar').count(),0);
// 同一工作区切换会话时不把当前预览盖到另一个会话。
await page.locator('[data-action=interaction-demo]').click();await page.locator('[data-p2-open=process]').click();if(await page.locator('[data-action=toggle-left]').getAttribute('aria-expanded')==='false')await page.locator('[data-action=toggle-left]').click();await page.locator('[data-action=select-session]').first().click();assert.equal(await page.locator('.p2-bar').count(),0);assert.equal(await page.locator('#prompt').count(),1);
assert.deepEqual(errors,[]);const result={states,screenshots:28,errors,checks:['原工作台内展示','确认/取消及焦点恢复','失败保留草稿','Esc 关闭','目录重试','IME 不执行','历史前插锚点','未知内容转义','退出恢复原草稿','切换会话退出对应预览']};await fs.writeFile(path.join(__dirname,'second-priority-report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
