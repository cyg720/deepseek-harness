/** Validate the delivered PRD on a real offline file page in isolated Chromium. */
const { chromium } = require('C:/Users/18010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const out = __dirname;
const root = path.dirname(out);
const htmlPath = path.join(root, '授权中心.prd.html');
const report = { startedAt: new Date().toISOString(), mode: 'file', cases: [] };
const errors = [], consoleErrors = [], requests = [];
function stateOfHtml(text) { return JSON.parse(text.match(/<script id="prd-data" type="application\/json">([\s\S]*?)<\/script>/)[1]); }
function stateOfMd(text) {
  const cut = text.indexOf(' -->\n');
  return {...JSON.parse(text.slice('<!-- prd-workspace:'.length, cut)), markdown: text.slice(cut + 5)};
}
async function test(name, fn, detail = '') {
  try { await fn(); report.cases.push({ name, status: '通过', detail }); }
  catch (e) { report.cases.push({ name, status: '失败', detail: String(e), stack: e.stack }); }
}
async function main() {
  const original = stateOfHtml(await fs.readFile(htmlPath, 'utf8'));
  const browser = await chromium.launch({ executablePath: 'C:/Users/18010/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe', headless: true });
  report.browser = 'Chromium ' + browser.version();
  report.platform = process.platform;
  const context = await browser.newContext({ viewport: {width: 1440, height: 1000}, acceptDownloads: true });
  await context.setOffline(true);
  context.on('request', r => { if (/^(https?|wss?):/.test(r.url())) requests.push(r.url()); });
  async function newPage(file = htmlPath, viewport) {
    const p = await context.newPage();
    if (viewport) await p.setViewportSize(viewport);
    p.on('pageerror', e => errors.push(String(e)));
    p.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    await p.goto(pathToFileURL(file).href, {waitUntil: 'load'});
    await p.locator('.section').first().waitFor();
    return p;
  }
  async function md(p) { await p.locator('#editBtn').click(); return p.locator('#source').inputValue(); }
  async function download(p, button, name) {
    const pending = p.waitForEvent('download');
    await p.locator(button).click();
    const d = await pending;
    const file = path.join(out, name);
    await d.saveAs(file);
    return file;
  }
  let p;
  try { p = await newPage(); }
  catch (e) {
    report.cases.push({ name: '原生 file:// 离线启动', status: '失败', detail: String(e) });
    await browser.close();
    await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)+'\n');
    process.exitCode = 1; return;
  }
  const accept = d => d.accept();
  p.on('dialog', accept);
  const count = await p.locator('.section').count();
  await test('原生 file:// 离线启动及完整正文', async () => {
    assert.ok(p.url().startsWith('file:'));
    assert.equal(await md(p), original.markdown);
    assert.equal(count, 15);
    assert.ok(await p.locator('table').count() > 25);
    assert.equal(await p.locator('pre').count(), 3);
    assert.equal(await p.locator('#cacheOpt').isChecked(), false);
    await p.locator('#readBtn').click();
  });
  await p.screenshot({path: path.join(out, 'desktop.png')});
  await test('未编辑 MD 导出逐字一致', async () => {
    const f = await download(p, '#exportMdBtn', 'unchanged.prd.md');
    assert.deepEqual(stateOfMd(await fs.readFile(f, 'utf8')), original);
  });
  await test('全文搜索、空结果与清空恢复', async () => {
    await p.locator('#search').fill('idx_token_account_id');
    assert.equal(await p.locator('.section:visible').count(), 1);
    await p.locator('#search').fill('NO-MATCH-SYNTHETIC-98765');
    assert.equal(await p.locator('.section:visible').count(), 0);
    assert.ok(await p.locator('#noResults').isVisible());
    await p.locator('#search').fill('');
    assert.equal(await p.locator('.section:visible').count(), count);
  });
  await test('目录跳转恢复全文', async () => {
    await p.locator('#search').fill('idx_token_account_id');
    await p.locator('#toc a').last().click();
    assert.equal(await p.locator('#search').inputValue(), '');
    assert.equal(await p.locator('.section:visible').count(), count);
  });
  const fixture = '\n合成往返验证：中文 😀 < > & `code`。\n\n| 字段 | 内容 |\n|---|---|\n| 测试 | a\\|b |\n\n```json\n{"内容":"中文", "pipe":"a|b", "end":"</script>"}\n```\n\n```sql\nSELECT \'合成验证\';\n```\n';
  await test('章节编辑保留中文、表格、JSON/SQL 围栏和特殊符号', async () => {
    await p.locator('button[data-edit]').first().click();
    const value = await p.locator('#sectionSource').inputValue();
    await p.locator('#sectionSource').fill(value + fixture);
    await p.locator('#applyEditBtn').click();
    assert.ok((await md(p)).includes(fixture));
    await p.locator('#readBtn').click();
  });
  await test('Esc 取消章节编辑并恢复焦点', async () => {
    const before = await md(p); await p.locator('#readBtn').click();
    await p.locator('button[data-edit]').first().click();
    await p.locator('#sectionSource').fill('不应保存的合成内容');
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('#editDialog').isVisible(), false);
    assert.ok(await p.evaluate(() => document.activeElement.matches('button[data-edit]')));
    assert.equal(await md(p), before);
  });
  await test('全文编辑即时预览', async () => {
    const before = await md(p);
    await p.locator('#source').fill(before + '\n全文编辑合成标记。\n');
    await p.locator('#article').getByText('全文编辑合成标记。', {exact: true}).waitFor();
    await p.locator('#readBtn').click();
  });
  await test('任务勾选写回 Markdown 并说明非验收', async () => {
    await p.locator('input[data-task-line]').first().check();
    assert.ok((await md(p)).includes('- [x] 指定 Q'));
    assert.ok((await p.locator('#toast').innerText()).includes('不代表测试执行'));
    await p.locator('#readBtn').click();
  });
  await test('批注写入正文且填写人未验证', async () => {
    await p.locator('#reviewBtn').click();
    await p.locator('#reviewAuthor').fill('自动化合成验证');
    await p.locator('#reviewRef').fill('Q-02');
    await p.locator('#reviewText').fill('合成批注：核对组织范围。<script>window.__prdPwned=1</script>');
    await p.locator('#addReviewBtn').click();
    const text = await md(p);
    assert.ok(text.includes('合成批注：核对组织范围。'));
    assert.ok(text.includes('未验证'));
    assert.equal(await p.evaluate(() => window.__prdPwned), undefined);
  });
  const current = await md(p);
  let exported;
  await test('编辑后 MD 实际下载与当前正文一致', async () => {
    const f = await download(p, '#exportMdBtn', 'roundtrip.prd.md');
    exported = stateOfMd(await fs.readFile(f, 'utf8'));
    assert.equal(exported.markdown, current);
  });
  await test('导出 HTML 原生 file:// 重开、正文批注和编辑保留', async () => {
    const f = await download(p, '#exportHtmlBtn', 'roundtrip.prd.html');
    assert.deepEqual(stateOfHtml(await fs.readFile(f, 'utf8')), exported);
    const q = await newPage(f);
    assert.equal(await md(q), current);
    await q.locator('#readBtn').click();
    await q.locator('button[data-edit]').first().click();
    assert.ok(await q.locator('#editDialog').isVisible());
    await q.close();
  });
  await test('双格式 ZIP 实际下载', async () => {
    const f = await download(p, '#exportBundleBtn', 'roundtrip.zip');
    assert.ok((await fs.stat(f)).size > 1000);
  }, 'ZIP CRC 和两文件快照一致性由 verify_exports.py 独立验证。');
  await test('Ctrl+S 发起双格式导出', async () => {
    const promise = p.waitForEvent('download'); await p.keyboard.press('Control+s');
    await (await promise).saveAs(path.join(out, 'keyboard.zip'));
  });
  await test('导入已导出 MD 保留当前正文和批注', async () => {
    await p.locator('#fileInput').setInputFiles(path.join(out, 'roundtrip.prd.md'));
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('已导入'));
    assert.equal(await md(p), current);
  });
  await test('合法 JSON 快照导入', async () => {
    await p.locator('#fileInput').setInputFiles({name:'valid.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(exported))});
    await p.waitForTimeout(100);
    assert.equal(await md(p), current);
  });
  await test('取消覆盖不丢失正文', async () => {
    p.off('dialog', accept); p.once('dialog', d => d.dismiss());
    await p.locator('#fileInput').setInputFiles({name:'other.md', mimeType:'text/markdown', buffer:Buffer.from('# 合成替换文档\n')});
    await p.waitForTimeout(100);
    assert.equal(await md(p), current); p.on('dialog', accept);
  });
  await test('非法和超限输入拒绝且保留正文', async () => {
    for (const input of [
      {name:'bad.json', mimeType:'application/json', buffer:Buffer.from('{"schemaVersion":999}')},
      {name:'large.md', mimeType:'text/markdown', buffer:Buffer.alloc(5*1024*1024+10001, 65)}
    ]) {
      await p.locator('#fileInput').setInputFiles(input); await p.waitForTimeout(100);
      assert.equal(await md(p), current);
      assert.ok((await p.locator('#toast').innerText()).includes('未导入'));
    }
  });
  await test('脚本/事件/脚本链接/外部图片均不执行或加载', async () => {
    const q = await newPage(); const before = await md(q);
    const attack='\n<script>window.__prdPwned=1</script>\n<img src="https://invalid.example/pixel" onerror="window.__prdPwned=1">\n\n[坏链接](javascript:alert(1))\n\n![追踪](https://invalid.example/pixel)\n';
    await q.locator('#source').fill(before+attack); await q.locator('#readBtn').click();
    assert.equal(await q.evaluate(() => window.__prdPwned), undefined);
    assert.equal(await q.locator('#article script,#article img,#article iframe,#article [onerror],a[href^="javascript:"]').count(), 0);
    assert.equal(await md(q), before+attack); await q.close();
  });
  await test('缓存不可用时提示且可导出（显式故障注入）', async () => {
    const q = await newPage(); q.on('dialog', accept);
    await q.evaluate(() => Object.defineProperty(window, 'localStorage', {configurable:true, get(){throw new Error('合成存储不可用');}}));
    await q.locator('#cacheOpt').click();
    assert.equal(await q.locator('#cacheOpt').isChecked(), false);
    assert.ok((await q.locator('#saveStatus').innerText()).includes('不可用'));
    const f=await download(q, '#exportMdBtn', 'cache-fallback.prd.md');
    assert.equal(stateOfMd(await fs.readFile(f,'utf8')).markdown, original.markdown); await q.close();
  });
  await test('真实 file:// 本机草稿写入与重开恢复（隔离浏览器）', async () => {
    const q=await newPage(); q.on('dialog',accept);
    await q.locator('#cacheOpt').click();
    assert.equal(await q.locator('#cacheOpt').isChecked(),true);
    const before=await md(q);
    await q.locator('#source').fill(before+'\n真实缓存合成测试。\n');
    await q.locator('#readBtn').click();
    const saved=await md(q);
    const r=await newPage(); r.on('dialog',accept);
    assert.ok(await r.locator('#recovery').isVisible());
    assert.equal(await md(r),original.markdown);
    await r.locator('#restoreBtn').click();
    assert.equal(await md(r),saved);
    await r.locator('#clearCacheBtn').click();
    await r.close(); await q.close();
  },'使用隔离 Playwright 浏览器上下文的真实 localStorage，不使用用户浏览器配置。');
  await test('缓存基线不一致不覆盖正文（合成不一致记录）', async () => {
    const q=await newPage(); q.on('dialog',accept);
    const key='prd-writer:v3:'+original.docId+':'+original.revision;
    await q.evaluate(({key,original})=>localStorage.setItem(key,JSON.stringify({baseDocId:original.docId,baseRevision:original.revision,baseMarkdown:'不同基线',state:original})),{key,original});
    const r=await newPage(); r.on('dialog',accept);
    assert.equal(await r.locator('#recovery').isVisible(),false);
    assert.ok((await r.locator('#saveStatus').innerText()).includes('基线不一致'));
    assert.equal(await md(r),original.markdown);
    await r.locator('#clearCacheBtn').click(); await r.close(); await q.close();
  });
  await test('真实双标签缓存竞争暂停覆盖并可导出', async () => {
    const q=await newPage(); q.on('dialog',accept);
    await q.locator('#cacheOpt').click();
    const r=await newPage(); r.on('dialog',accept);
    await r.locator('#cacheOpt').click();
    const before=await md(q);
    await q.locator('#source').fill(before+'\n标签 A 合成变更。\n');
    await q.locator('#readBtn').click();
    await r.waitForFunction(()=>document.querySelector('#saveStatus').textContent.includes('另一页面'));
    assert.equal(await r.locator('#cacheOpt').isChecked(),false);
    assert.equal(await md(r),original.markdown);
    await download(r,'#exportMdBtn','cache-conflict.prd.md');
    await r.locator('#clearCacheBtn').click(); await r.close(); await q.close();
  },'两页打开同一 file:// 路径，使用真实 storage 事件；不宣称多人协作或其他浏览器一致。');
  await test('恶意版本元信息导出后本地重开不执行', async () => {
    const q=await newPage(); q.on('dialog',accept);
    const attack={...original,docId:'synthetic.prd.security',version:'</script><script>window.__prdPwned=1</script>'};
    await q.locator('#fileInput').setInputFiles({name:'metadata.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(attack))});
    await q.waitForTimeout(100);
    const f=await download(q,'#exportHtmlBtn','metadata-security.html');
    assert.deepEqual(stateOfHtml(await fs.readFile(f,'utf8')),attack);
    const r=await newPage(f);
    assert.equal(await r.evaluate(()=>window.__prdPwned),undefined);
    assert.equal(await md(r),original.markdown); await r.close(); await q.close();
  });
  await test('390px 窄屏无横向页面溢出、目录与 Esc', async () => {
    const q=await newPage(htmlPath,{width:390,height:844});
    assert.ok(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await q.locator('#menuBtn').click(); assert.ok(await q.locator('#sidebar').isVisible());
    await q.keyboard.press('Escape'); assert.equal(await q.locator('#sidebar').isVisible(),false);
    await q.screenshot({path:path.join(out,'mobile.png')}); await q.close();
  });
  await test('打印样式隐藏控件、恢复全文', async () => {
    const q=await newPage(); await q.locator('#search').fill('idx_token_account_id');
    await q.emulateMedia({media:'print'});
    assert.equal(await q.locator('.topbar').isVisible(),false);
    assert.equal(await q.locator('.section:visible').count(),count);
    await q.screenshot({path:path.join(out,'print-style.png')}); await q.close();
  },'验证打印 CSS，未交付 PDF 或测试实际打印机。');
  await test('无隐式网络请求', async () => assert.deepEqual(requests, []));
  await test('无未处理脚本或控制台错误', async () => {assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);});
  await browser.close();
  report.finishedAt=new Date().toISOString();
  report.summary={passed:report.cases.filter(x=>x.status==='通过').length,failed:report.cases.filter(x=>x.status==='失败').length};
  report.implicitNetworkRequests=requests;report.pageErrors=errors;report.consoleErrors=consoleErrors;
  report.limitations=['只覆盖报告所列 Chromium 和桌面/390px 模拟视口；未验证其他浏览器、真实手机和辅助阅读器。','真实 file:// 缓存写入/重开恢复/双标签竞争只在隔离上下文内验证；未验证浏览器退出后持久性、系统配额或企业策略。缓存不可用和基线不一致分别使用显式故障注入和合成记录。','模板禁用 Markdown 相对文件链接；原资料请在文件夹中打开。','测试修改/批注只在隔离页面和 validation 导出副本；正式交付文档保持原始待决策正文。','未执行授权中心业务、数据库、性能、正式业务评审或验收。'];
  await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.summary));
  if(report.summary.failed)process.exitCode=1;
}
main().catch(async e=>{report.fatal=String(e);await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.error(e);process.exitCode=1;});
