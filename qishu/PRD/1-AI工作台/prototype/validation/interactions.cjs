/* Browser checks for the local approval/question prototype, without backend calls. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 const click=a=>page.locator(`[data-action="${a}"]`).first().click();
 const start=async s=>{await click('interaction-demo');await page.locator(`[data-scenario="${s}"]`).click();};
 const settled=()=>page.waitForFunction(()=>!document.querySelector('#interaction-card'));
 const stored=()=>page.evaluate(()=>{const x=JSON.parse(localStorage.getItem('yuvi-prototype-v1')),w=x.workspaces[x.workspace];return w.sessions.find(s=>s.id===w.current);});
 try{
  await page.goto(process.env.PROTOTYPE_URL||pathToFileURL(path.join(root,'index.html')).href);
  await click('fill-demo');await page.locator('#login-form button[type=submit]').click();await page.locator('.app').waitFor();
  await start('approval');assert.match(await page.locator('.interaction-detail').innerText(),/export_inspection/);
  await page.locator('.interaction-simulation summary').click();await page.locator('[data-fail-next]').check();
  await page.locator('[data-answer="allowed-once"]').click();assert.equal(await page.locator('[data-answer="rejected"]').isDisabled(),true);
  await page.locator('.interaction-error').waitFor();assert.match(await page.locator('.interaction-error').innerText(),/保留/);
  await page.locator('[data-answer="allowed-once"]').click();await settled();assert.equal((await stored()).interactionAnswers[0].answer,'allowed-once');checks.push('approval details, submitting lock, failure and retry');
  await start('approval');await page.locator('[data-answer="rejected"]').click();await settled();assert.equal((await stored()).interactionAnswers[0].answer,'rejected');
  await start('fallback');assert.match(await page.locator('.interaction-detail').innerText(),/无法获取/);await page.locator('.interaction-simulation summary').click();await click('interaction-revoke');assert.equal((await stored()).interactionAnswers,undefined);checks.push('rejection, detail fallback, revocation without rejection');
  await start('questions');await click('interaction-submit');assert.equal(await page.locator('.interaction-field-error:visible').count(),3);
  await page.locator('[data-question=area][value="二车间"]').check();await page.locator('#iq-area-custom').fill('办公区');assert.equal(await page.locator('[data-question=area]:checked').count(),0);
  await page.locator('[data-question=area][value="东侧仓库"]').check();assert.equal(await page.locator('#iq-area-custom').inputValue(),'');
  await page.locator('[data-question=focus][value="设备温度"]').check();await page.locator('[data-question=focus][value="消防通道"]').check();await page.locator('#iq-focus-custom').fill('补充配电室');await page.locator('#iq-notes-custom').fill('先给摘要，再附检查表');
  const session=(await stored()).id;
  await click('new-chat');await page.locator(`[data-action=select-session][data-id="${session}"]`).click();assert.equal(await page.locator('#iq-focus-custom').inputValue(),'补充配电室');
  await page.reload();assert.equal(await page.locator('#iq-notes-custom').inputValue(),'先给摘要，再附检查表');
  await click('interaction-submit');await settled();const answers=(await stored()).interactionAnswers[0].answer.answers;assert.deepEqual(answers[1],{id:'focus',selected:['设备温度','消防通道'],custom:'补充配电室'});checks.push('batch validation, single/custom exclusion, multi/custom combination, session and reload preservation');
  await start('free');await page.locator('#iq-requirements-custom').fill('优先检查消防通道');await click('interaction-submit');await settled();assert.deepEqual((await stored()).interactionAnswers[0].answer.answers[0],{id:'requirements',selected:[],custom:'优先检查消防通道'});
  for(const scenario of ['plan','approve-only']){await start(scenario);assert.equal(await page.locator('.interaction-actions button').count(),scenario==='plan'?2:1);await page.locator('[data-answer="按此方案继续"]').click();await settled();assert.deepEqual((await stored()).interactionAnswers[0].answer.answers[0].selected,['按此方案继续']);}checks.push('free text, named approval in second position, approve-only plan');
  await start('questions');await page.locator('#iq-area-custom').fill('办公区');await page.locator('#iq-focus-custom').fill('照明');await page.locator('#iq-notes-custom').fill('表格');await click('interaction-submit');await click('new-chat');await page.waitForTimeout(1000);assert.equal(await page.locator('#interaction-card').count(),0);assert.equal(await page.locator('.messages').count(),0);checks.push('async completion does not write into a different session');
  const samples=[];
  for(const theme of ['light','dark']){
   await page.evaluate(t=>{state.settings.theme=t;save();renderApp();},theme);
   for(const width of [320,390,699,701,959,961,1440]){
    await page.setViewportSize({width,height:900});
    for(const scenario of ['approval','questions','plan']){
     await start(scenario);await page.locator('#interaction-card').scrollIntoViewIfNeeded();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${theme}/${width}/${scenario}`);
     assert.equal(await page.locator('#interaction-card').evaluate(e=>e.scrollWidth>e.clientWidth),false);
     if([390,1440].includes(width)){await page.locator('#interaction-title').focus();await page.screenshot({path:path.join(root,'preview',`interaction-${scenario}-${width}-${theme}.png`)});}
     samples.push({theme,width,scenario});
    }
   }
  }
  checks.push('42 theme/viewport/scenario combinations without horizontal overflow');assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(__dirname,'interactions-report.json'),JSON.stringify({browser:browser.version(),checks,samples,errors},null,2)+'\n');
  console.log('PASS '+checks.join('\nPASS '));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
