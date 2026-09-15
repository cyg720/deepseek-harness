const { chromium } = require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const out=path.resolve(process.argv[2] || path.join(__dirname,'../../test-results/toc'));
const {spawnSync}=require('node:child_process');
const examples=path.resolve(__dirname,'../examples');
async function main(){
 await fs.mkdir(out,{recursive:true});
 const build=spawnSync(process.env.PRD_PYTHON || 'python',[path.join(__dirname,'render_prd.py'),path.join(examples,'toc-ddl-source.md'),'--out-dir',out,'--stem','toc-ddl-demo','--doc-id','synthetic.toc-ddl','--version','demo','--force'],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'}});
 if(build.error)throw build.error;
 if(build.status!==0)throw Error(build.stderr || build.stdout);

 const browser=await chromium.launch({headless:true,executablePath:process.env.PRD_CHROMIUM});
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});await context.setOffline(true);
 const errors=[],requests=[],results=[];
 context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 async function open(file){const p=await context.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(pathToFileURL(file).href);await p.locator('.section').first().waitFor();return p;}
 async function test(name,fn){try{await fn();results.push({name,status:'通过'});}catch(e){results.push({name,status:'失败',error:String(e)});}}
 const p=await open(path.join(out,'toc-ddl-demo.prd.html'));
 const nav=p.locator('#toc'),parent=nav.getByRole('link',{name:'四、数据库设计',exact:true});
 await test('全部层级唯一定位且忽略代码围栏',async()=>{
  assert.equal(await nav.locator('a').count(),12);
  assert.equal(await nav.getByText('代码中的标题').count(),0);
  const ids=await nav.locator('a').evaluateAll(xs=>xs.map(a=>a.dataset.toc));assert.equal(ids.length,new Set(ids).size);
  assert.equal(await p.evaluate(ids=>ids.every(id=>document.getElementById(id)),ids),true);
  assert.equal(await nav.locator('ul ul ul ul ul').count()>0,true);
 });
 await test('父目录点击折叠并定位、再次展开',async()=>{
  await parent.click();assert.equal(await nav.getByRole('link',{name:'4.1 建表、注释与索引',exact:true}).isVisible(),false);
  assert.equal(await p.evaluate(()=>document.activeElement.id),await parent.getAttribute('data-toc'));
  await parent.click();assert.ok(await nav.getByRole('link',{name:'4.1 建表、注释与索引',exact:true}).isVisible());
 });
 await test('箭头仅折叠，键盘 Enter/Space 可展开',async()=>{
  const btn=parent.locator('..').locator('button');await btn.focus();await p.keyboard.press('Space');assert.equal(await btn.getAttribute('aria-expanded'),'false');
  await p.keyboard.press('Enter');assert.equal(await btn.getAttribute('aria-expanded'),'true');
 });
 await test('重复子标题直达各自内容并恢复被搜索隐藏的章节',async()=>{
  const links=nav.getByRole('link',{name:'同名标题',exact:true});assert.equal(await links.count(),2);
  await p.locator('#search').fill('不存在的词');assert.equal(await p.locator('.section:visible').count(),0);
  await links.nth(1).click();assert.equal(await p.locator('#search').inputValue(),'');
  assert.equal(await p.evaluate(()=>document.activeElement.id),await links.nth(1).getAttribute('data-toc'));
  assert.equal(await links.nth(1).getAttribute('aria-current'),'location');
 });
 await test('最深标题和跳级标题定位',async()=>{
  for(const name of ['执行记录','跳级标题']){const a=nav.getByRole('link',{name,exact:true});await a.click();assert.equal(await p.evaluate(()=>document.activeElement.id),await a.getAttribute('data-toc'));}
 });
 await test('SQL 正文与文件一致，表列注释及索引保留',async()=>{
  const sql=await fs.readFile(path.join(examples,'toc-ddl-demo.schema.sql'),'utf8');
  assert.equal((await p.locator('pre code').first().textContent()).trim(),sql.trim());
  assert.equal((sql.match(/COMMENT ON TABLE/g)||[]).length,2);assert.equal((sql.match(/COMMENT ON COLUMN/g)||[]).length,6);
  assert.ok(sql.includes('CREATE INDEX idx_demo_device_category_id'));
 });
 await test('全文编辑标题新增删除同步目录',async()=>{
  await p.locator('#editBtn').click();const source=await p.locator('#source').inputValue();
  await p.locator('#source').fill(source.replace('### 同名标题\n\n第一个目标。','### 修改后标题\n\n第一个目标。')+'\n### 新增标题\n\n新增内容。\n');
  await nav.getByRole('link',{name:'新增标题',exact:true}).waitFor();
  assert.equal(await nav.getByRole('link',{name:'同名标题',exact:true}).count(),1);
  await nav.getByRole('link',{name:'新增标题',exact:true}).click();assert.equal(await p.locator('#sourcepanel').isVisible(),false);
 });
 await test('导出 HTML 重开仍有多级目录、最新标题及离线图形',async()=>{
  const pending=p.waitForEvent('download');await p.locator('#exportHtmlBtn').click();const d=await pending;const file=path.join(out,'toc-roundtrip.html');await d.saveAs(file);
  const q=await open(file);assert.ok(await q.locator('#toc').getByRole('link',{name:'修改后标题',exact:true}).isVisible());
  await q.waitForFunction(()=>document.querySelectorAll('.diagram-view svg').length===1);
  await q.close();
 });
 await test('章节编辑与导入同步新目录',async()=>{
  await p.locator('button[data-edit]').last().click();await p.locator('#sectionSource').fill('## 导入前章节\n\n### 章节编辑子标题\n\n内容\n');await p.locator('#applyEditBtn').click();
  await nav.getByRole('link',{name:'章节编辑子标题',exact:true}).waitFor();
  p.on('dialog',d=>d.accept());await p.locator('#fileInput').setInputFiles({name:'new.md',mimeType:'text/markdown',buffer:Buffer.from('# 新文档\n\n## 新章节\n\n### 导入子标题\n\n文本\n')});
  await nav.getByRole('link',{name:'导入子标题',exact:true}).waitFor();assert.equal(await nav.getByRole('link',{name:'章节编辑子标题',exact:true}).count(),0);
 });
 await test('窄屏目录展开与定位关闭菜单',async()=>{
  const q=await open(path.join(out,'toc-ddl-demo.prd.html'));await q.setViewportSize({width:390,height:844});await q.locator('#menuBtn').click();
  await q.locator('#toc').getByRole('link',{name:'执行记录',exact:true}).click();assert.equal(await q.locator('#sidebar').isVisible(),false);
  assert.ok(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await q.close();
 });
 const shot=await open(path.join(out,'toc-ddl-demo.prd.html'));await shot.screenshot({path:path.join(out,'toc-desktop.png')});await shot.close();
 await test('断网无请求与未处理错误',async()=>{assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);});
 const report={browser:browser.version(),results,passed:results.filter(x=>x.status==='通过').length,failed:results.filter(x=>x.status==='失败').length,scope:'原生 file://，离线 Chromium；SQL 未执行'};
 await fs.writeFile(path.join(out,'toc-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();if(report.failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
