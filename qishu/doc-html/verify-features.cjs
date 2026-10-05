/** Exercise capability coverage and navigation in an offline browser. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({offline:true,viewport:{width:1600,height:1000}}),page=await context.newPage();
 const errors=[],network=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
 const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
 await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href+'#features');await page.waitForFunction(()=>window.atlasReady,{timeout:120000});
 check('menu opens capability inventory',await page.locator('.fc-detail').isVisible());
 check('all 307 packages represented once',await page.evaluate(()=>D.features.items.length===307&&new Set(D.features.items.map(f=>f.id)).size===D.packages.length));
 check('nine major modules',await page.locator('.fc-module').count()===9);
 check('read_image concrete operation shown',(await page.locator('#fc-detail').innerText()).includes('read_image'));
 await page.locator('#fc-query').fill('read_image');check('tool name search',await page.locator('.fc-item').count()>0&&await page.locator('.fc-item').count()<307);
 await page.locator('#fc-query').fill('unmatched-capability-987');check('empty search has no stale entries',await page.locator('.fc-item').count()===0);
 await page.locator('[data-fc-reset]').click();
 await page.locator('[data-fc-area="tools"]').click();check('module filter narrows menu',await page.locator('.fc-module').count()===1);
 for(const tab of ['implementation','relations','config','evidence','overview']){await page.locator(`[data-fc-tab="${tab}"]`).click();check(tab+' tab renders',await page.locator('.fc-section').count()>0);}
 await page.locator('[data-fc-tab="implementation"]').click();check('original JSDoc present',await page.locator('.fc-comment').count()>0);
 await page.locator('.fc-section [data-file]:visible').first().click();check('implementation links open offline source',await page.locator('#detail').evaluate(e=>e.open));await page.locator('[data-close="detail"]').click();
 await page.locator('[data-fc-tab="relations"]').click();await page.locator('.fc-chip[data-feature]').first().click();check('dependency links select related capability',await page.evaluate(()=>FC.selected!=='@deepseek-ai/dsh-tool-fs'));
 await page.reload();await page.waitForFunction(()=>window.atlasReady);check('deep link survives reload',await page.evaluate(()=>decodeURIComponent(location.hash.split('/').slice(1).join('/'))===FC.selected));
 const coverage=await page.evaluate(()=>{
  let renders=0;for(const f of D.features.items){FC.selected=f.id;for(const tab of ['overview','implementation','relations','config','evidence']){FC.tab=tab;paintFeatureDetail();if(!document.querySelector('.fc-section'))throw Error(f.id+' '+tab);renders++;}}
  return {renders,features:D.features.items.length,tools:D.features.toolCount,comments:D.features.items.reduce((n,f)=>n+f.comments.length,0)};
 });check('all capability detail tabs render',coverage.renders===1535);
 await page.evaluate(()=>{FC.selected='@deepseek-ai/dsh-tool-fs';FC.tab='overview';FC.area='all';FC.query='';history.replaceState(null,'','#features');renderFeatures();});
 for(const width of [390,900,1440,1920]){await page.setViewportSize({width,height:1000});check('responsive width '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:1600,height:1000});await page.screenshot({path:path.join(__dirname,'preview-features.png'),fullPage:true,animations:'disabled'});
 await page.locator('#theme').click();check('dark theme',await page.evaluate(()=>document.documentElement.dataset.theme==='dark'));
 check('no browser errors',errors.length===0);check('no network requests',network.length===0);
 fs.writeFileSync(path.join(__dirname,'verification-features.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks,coverage,errors,network},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,coverage,errors,network}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
