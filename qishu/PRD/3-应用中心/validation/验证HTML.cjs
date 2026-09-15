/* Validate the actual delivered document in offline Chromium; no business traffic. */
const { chromium } = require('C:/Users/18010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const base = path.resolve(__dirname, '..');
const report = { executedAt: new Date().toISOString(), cases: [], limits: [] };
const errors = [], requests = [];
const stateOf = raw => JSON.parse(raw.match(/<script id="prd-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const mdState = raw => { const hit = raw.match(/^<!-- prd-workspace:(.*?) -->\n/); return {...JSON.parse(hit[1]), markdown: raw.slice(hit[0].length)}; };
const baseline = stateOf(fs.readFileSync(path.join(base,'应用中心.prd.html'),'utf8'));
async function test(name, fn) { try { await fn(); report.cases.push({name,status:'通过'}); } catch(e) { report.cases.push({name,status:'失败',details:String(e.stack)}); } }
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/18010/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe' });
  report.browser = await browser.version();
  const context = await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true,offline:true});
  context.on('request',r => {if (/^(https?|wss?):/.test(r.url())) requests.push(r.url());});
  async function open(file) {
    const p = await context.newPage(); p.on('pageerror',e=>errors.push(String(e))); p.on('dialog',d=>d.accept());
    await p.goto(pathToFileURL(file).href); await p.locator('.section').first().waitFor(); await diagrams(p); return p;
  }
  async function diagrams(p) { await p.waitForFunction(()=>document.querySelectorAll('.diagram[data-diagram-state="pending"]').length===0); }
  async function source(p) {await p.locator('#editBtn').click(); return p.locator('#source').inputValue();}
  async function download(p,selector,name) {const waiting=p.waitForEvent('download');await p.locator(selector).click();const d=await waiting;const target=path.join(__dirname,name);await d.saveAs(target);return target;}
  const page = await open(path.join(base,'应用中心.prd.html'));
  await test('file://断网打开真实应用中心PRD、三张原位SVG',async()=>{
    assert.equal(await page.locator('.diagram-view svg').count(),3);
    assert.equal(await page.locator('.diagram[data-diagram-state="error"]').count(),0);
    assert.equal(await source(page),baseline.markdown);await page.locator('#readBtn').click();
    await page.screenshot({path:path.join(__dirname,'桌面.png')});
    await page.locator('.diagram').first().screenshot({path:path.join(__dirname,'一图统揽.png')});
  });
  await test('多级目录覆盖标题、折叠与键盘定位',async()=>{
    const heads=await page.locator('#article h2,#article h3,#article h4,#article h5,#article h6').count();
    assert.equal(await page.locator('#toc a[data-toc]').count(),heads);
    const button=page.locator('#toc button[data-toggle-toc]').first();const original=await button.getAttribute('aria-expanded');await button.click();assert.notEqual(await button.getAttribute('aria-expanded'),original);await button.click();
    const link=page.locator('#toc a[data-toc]').filter({hasText:'9.2 逐条可执行用例'});await link.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),await link.getAttribute('data-toc'));
  });
  await test('搜索及清空恢复',async()=>{const count=await page.locator('.section:visible').count();await page.locator('#search').fill('qs__app__sync_job');assert.ok(await page.locator('.section:visible').count()<count);await page.locator('#search').fill('');assert.equal(await page.locator('.section:visible').count(),count);});
  await test('章节编辑与Esc取消',async()=>{await page.locator('button[data-edit]').nth(2).click();const text=await page.locator('#sectionSource').inputValue();await page.locator('#sectionSource').fill(text+'\n合成章节验证 中文。\n');await page.locator('#applyEditBtn').click();assert.ok((await source(page)).includes('合成章节验证'));await page.locator('#readBtn').click();await page.locator('button[data-edit]').nth(2).click();await page.locator('#sectionSource').fill('不应保留');await page.keyboard.press('Escape');assert.ok((await source(page)).includes('合成章节验证'));assert.ok(!(await source(page)).includes('不应保留'));});
  await test('全文连续编辑及图形重绘',async()=>{const raw=await source(page);await page.locator('#source').fill(raw+'\n合成快速编辑1\n');await page.locator('#source').fill(raw+'\n合成快速编辑2\n');await page.waitForTimeout(600);await diagrams(page);assert.equal(await page.locator('.diagram-view svg').count(),3);assert.ok(!(await source(page)).includes('合成快速编辑1'));await page.locator('#readBtn').click();});
  await test('勾选写回正文，非正式验收',async()=>{await page.locator('input[data-task-line]').first().check();assert.ok((await source(page)).includes('- [x] 产品与相关服务负责人'));await page.locator('#readBtn').click();});
  await test('批注写回并阻止脚本执行',async()=>{await page.locator('#reviewBtn').click();await page.locator('#reviewAuthor').fill('合成文档测试');await page.locator('#reviewRef').fill('Q-05');await page.locator('#reviewText').fill('合成批注 <script>window.__prd_attack=1</script>');await page.locator('#addReviewBtn').click();assert.ok((await source(page)).includes('合成批注'));assert.equal(await page.evaluate(()=>window.__prd_attack),undefined);});
  let exported, bundle;
  await test('导出MD与当前正文逐字一致',async()=>{const current=await source(page);exported=mdState(fs.readFileSync(await download(page,'#exportMdBtn','往返.prd.md'),'utf8'));assert.equal(exported.markdown,current);});
  await test('导出HTML同快照、file重开图形和编辑保留',async()=>{const file=await download(page,'#exportHtmlBtn','往返.prd.html');assert.deepEqual(stateOf(fs.readFileSync(file,'utf8')),exported);const p=await open(file);assert.equal(await p.locator('.diagram-view svg').count(),3);assert.equal(await source(p),exported.markdown);await p.close();});
  await test('双格式ZIP与Ctrl+S实际下载',async()=>{bundle=await download(page,'#exportBundleBtn','往返.zip');assert.ok(fs.statSync(bundle).size>1000);const pending=page.waitForEvent('download');await page.keyboard.press('Control+s');await (await pending).saveAs(path.join(__dirname,'键盘.zip'));});
  await test('导入MD保持批注和图形',async()=>{await page.locator('#fileInput').setInputFiles(path.join(__dirname,'往返.prd.md'));await page.waitForTimeout(400);await diagrams(page);assert.equal(await source(page),exported.markdown);assert.equal(await page.locator('.diagram-view svg').count(),3);});
  await test('非法快照与超限文件不覆盖',async()=>{const before=await source(page);for(const input of [{name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":999}')},{name:'huge.md',mimeType:'text/markdown',buffer:Buffer.alloc(5*1024*1024+1,65)}]){await page.locator('#fileInput').setInputFiles(input);await page.waitForTimeout(250);assert.equal(await source(page),before);}});
  await test('取消导入保持原文',async()=>{const before=await source(page);page.removeAllListeners('dialog');page.once('dialog',d=>d.dismiss());await page.locator('#fileInput').setInputFiles({name:'other.md',mimeType:'text/markdown',buffer:Buffer.from('# 不应覆盖')});await page.waitForTimeout(250);assert.equal(await source(page),before);page.on('dialog',d=>d.accept());});
  await test('缓存不可用时仍可导出',async()=>{const p=await context.newPage();await p.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('合成缓存不可用','SecurityError');}}));await p.goto(pathToFileURL(path.join(base,'应用中心.prd.html')).href);await p.locator('.section').first().waitFor();await p.locator('#cacheOpt').click();assert.equal(await p.locator('#cacheOpt').isChecked(),false);await download(p,'#exportMdBtn','缓存降级.prd.md');await p.close();});
  await test('窄屏无页面横向溢出且图形存在',async()=>{await page.locator('#readBtn').click();await page.setViewportSize({width:390,height:844});await diagrams(page);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.equal(await page.locator('.diagram-view svg').count(),3);await page.screenshot({path:path.join(__dirname,'窄屏.png')});});
  await test('打印显示正文和三张图',async()=>{await page.setViewportSize({width:1440,height:1050});await page.emulateMedia({media:'print'});assert.equal(await page.locator('.diagram-view svg:visible').count(),3);await page.screenshot({path:path.join(__dirname,'打印样式.png')});await page.emulateMedia({media:'screen'});});
  await test('恶意内容和非法Mermaid仅局部失败',async()=>{await page.locator('#editBtn').click();await page.locator('#source').fill(baseline.markdown+'\n## 合成攻击检查\n<script>window.__prd_attack=1</script>\n[危险](javascript:alert(1))\n<img src="https://invalid.example/a" onerror="window.__prd_attack=2">\n```mermaid\nnot a diagram at all\n```\n');await page.waitForTimeout(600);await diagrams(page);assert.equal(await page.evaluate(()=>window.__prd_attack),undefined);assert.equal(await page.locator('.diagram-view svg').count(),3);assert.ok(await page.locator('.diagram[data-diagram-state="error"]').count()>0);});
  await test('无隐式网络请求和未处理异常',async()=>{assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);});
  report.networkRequests=requests;report.pageErrors=errors;
  report.limits.push('缓存不可用为明确注入的SecurityError；不证明所有浏览器缓存策略','未验证真实多人并发编辑；PRD工具不提供云端协作','所有业务TC未执行');
  fs.writeFileSync(path.join(__dirname,'浏览器验证.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();console.log(JSON.stringify({browser:report.browser,passed:report.cases.filter(c=>c.status==='通过').length,failed:report.cases.filter(c=>c.status==='失败').map(c=>({name:c.name,details:c.details}))}));
  process.exitCode=report.cases.some(c=>c.status==='失败')?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
