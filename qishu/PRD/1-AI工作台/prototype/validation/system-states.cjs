const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 const click=a=>page.locator(`[data-action="${a}"]`).first().click();
 const start=async scenario=>{await click('interaction-demo');await page.locator(`[data-action=system-start][data-scenario=${scenario}]`).click();};
 try{
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);await click('fill-demo');await page.locator('#login-form button[type=submit]').click();await page.locator('.app').waitFor();
 await page.locator('#prompt').fill('保留这段草稿');await start('connection');assert.equal(await page.locator('.send').isDisabled(),true);await page.locator('#prompt').fill('离线编辑的草稿');await page.locator('#prompt').press('Enter');assert.equal(await page.locator('#prompt').inputValue(),'离线编辑的草稿');
 await click('system-reconnect');assert.match(await page.locator('#connection-message').innerText(),/正在/);await click('system-fail');assert.match(await page.locator('#connection-message').innerText(),/未成功/);await click('system-reconnect');await page.waitForFunction(()=>document.querySelector('#connection-message')?.textContent==='连接已恢复');assert.equal(await page.locator('.send').isDisabled(),false);assert.equal(await page.locator('#prompt').inputValue(),'离线编辑的草稿');checks.push('disconnection blocks send, preserves editable draft, retry failure and recovery');
 await click('system-exit');await start('fault');assert.equal(await page.locator('#fault-title').evaluate(e=>e===document.activeElement),true);await click('system-retry');assert.equal(await page.locator('#prompt').inputValue(),'离线编辑的草稿');await start('fault');await page.locator('.system-fault summary').click();assert.match(await page.locator('#system-diagnostic').innerText(),/ROOT_RENDER_ERROR/);await click('system-reload');await page.locator('.app').waitFor();checks.push('root fault focus, retry preserves draft, diagnostics and real page reload');
 const before=await page.evaluate(()=>localStorage.getItem('yuvi-prototype-v1'));await start('empty');assert.match(await page.locator('.session-scroll').innerText(),/还没有会话/);await page.locator('[data-action=catalog]').first().click();assert.match(await page.locator('#modal').innerText(),/暂无可用内容/);await click('close-modal');await click('system-exit');assert.equal(await page.evaluate(()=>localStorage.getItem('yuvi-prototype-v1')),before);checks.push('empty session, inspector and tool directory without deleting real demo data');
 await start('loading');assert.equal(await page.locator('.system-skeleton').count()>10,true);await click('system-history');await click('history-load');assert.match(await page.locator('#history-status').innerText(),/正在加载/);await click('history-fail');assert.equal(await page.locator('.system-history-records .detail-banner').count(),1);await click('history-load');await page.waitForFunction(()=>document.querySelector('#history-status')?.textContent.includes('全部'));assert.equal(await page.locator('.system-history-records .detail-banner').count(),2);checks.push('skeleton, history loading/failure/retry, existing records preserved');await click('system-exit');
 for(const theme of ['light','dark'])for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>{state.settings.theme=t;renderApp();},theme);
  for(const scenario of ['connection','fault','empty','loading']){
   await start(scenario);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(root,'preview',`system-${scenario}-${width}-${theme}.png`)});await click('system-exit');
  }
 }
 checks.push('16 scenario/viewport/theme combinations without page overflow');assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(__dirname,'system-states-report.json'),JSON.stringify({browser:browser.version(),checks,errors},null,2)+'\n');console.log(checks.join('\n'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
