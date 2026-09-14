/** Parse and render the current PRD's Mermaid sources with the installed library. */
const {chromium}=require('C:/Users/18010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const root=path.dirname(__dirname);
const pkg=path.resolve(root,'../../../node_modules/.pnpm/mermaid@11.16.0/node_modules/mermaid');
let activeBrowser;
const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
async function main(){
  const md=await fs.readFile(path.join(root,'授权中心.prd.md'),'utf8');
  const diagrams=[...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m=>m[1].trim());
  assert.equal(diagrams.length,6);
  const names=['一图统揽','账号状态','应用状态','令牌生命周期（建议）','委托生命周期（待决策）','归档任务生命周期（建议）'];
  const version=JSON.parse(await fs.readFile(path.join(pkg,'package.json'),'utf8')).version;
  const report={checkedAt:new Date().toISOString(),mermaidVersion:version,sourceSha256:crypto.createHash('sha256').update(md).digest('hex'),cases:[]};
  const browser=await chromium.launch({headless:true,executablePath:'C:/Users/18010/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});
  activeBrowser=browser;
  report.browser=browser.version();
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  await context.setOffline(true);
  const p=await context.newPage();
  const requests=[];
  p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await p.setContent('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body></body></html>');
  await p.addScriptTag({content:await fs.readFile(path.join(pkg,'dist/mermaid.min.js'),'utf8')});
  await p.evaluate(()=>mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral',flowchart:{htmlLabels:false,useMaxWidth:true},state:{useMaxWidth:true},fontFamily:'Microsoft YaHei, sans-serif'}));
  const svgs=[];
  for(let i=0;i<diagrams.length;i++){
    const rendered=await p.evaluate(async ({source,id})=>{
      const parsed=await mermaid.parse(source);
      const result=await mermaid.render(id,source);
      return {type:parsed.diagramType,svg:result.svg};
    },{source:diagrams[i],id:'authdiagram'+i});
    assert.ok(rendered.svg.includes('<svg'));
    assert.ok(!/<script\b|\son\w+\s*=|(?:href|src)="https?:/i.test(rendered.svg));
    svgs.push(rendered.svg);
    await fs.writeFile(path.join(__dirname,`diagram-${i+1}.svg`),rendered.svg+'\n');
    report.cases.push({title:names[i],type:rendered.type,status:'通过',sourceSha256:crypto.createHash('sha256').update(diagrams[i]).digest('hex')});
  }
  let rejected=false;
  try{await p.evaluate(()=>mermaid.parse('stateDiagram-v2\n invalid --> :'));}catch{rejected=true;}
  assert.ok(rejected);
  report.invalidSyntaxRejected=true;
  assert.deepEqual(requests,[]);
  report.implicitNetworkRequests=requests;
  const license=await fs.readFile(path.join(pkg,'LICENSE'),'utf8');
  const sections=svgs.map((svg,i)=>`<section id="d${i}"><h2>${i+1}. ${escape(names[i])}</h2><div class="diagram">${svg}</div><details><summary>对应 Mermaid 源码</summary><pre>${escape(diagrams[i])}</pre></details></section>`).join('\n');
  const html=`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>授权中心需求方案图示 · 0.1.1</title><style>
*{box-sizing:border-box}body{margin:0;overflow-wrap:anywhere;background:#f4f6fb;color:#1c2e48;font:16px/1.65 'Microsoft YaHei',sans-serif}header,main,footer{max-width:1480px;margin:auto;padding:24px}h1{margin:0;font-size:32px}nav{display:flex;flex-wrap:wrap;gap:12px}a{color:#334cc0}section{margin:24px 0;background:white;border:1px solid #dce3ef;border-radius:14px;padding:24px}h2{font-size:22px}.diagram{overflow:auto}.diagram svg{display:block;width:100%;height:auto;min-width:900px;max-width:none!important}section:first-child .diagram svg{width:2800px;min-width:2800px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}summary{cursor:pointer}.notice{border-left:4px solid #6676df;padding:12px;background:#e9edfc}@media(max-width:600px){header,main,footer{padding:14px}section{padding:12px}h1{font-size:24px}}@media print{body{background:white}nav,details{display:none}section{break-before:page}.diagram svg{min-width:0!important}}</style></head><body>
<header><p>安全生产智能体平台 · 授权中心</p><h1>需求方案图示</h1><p>业务版本 0.1.1 · 待决策 · 2026-09-12</p><p class="notice">本图册由授权中心.prd.md 的六个 Mermaid 图块生成。宽图可在图框内横向滚动查看。图用于阅读，编号条款与相邻状态转移表是判定依据。建议方案不代表批准；修改需求后须重新生成本图册。</p><nav>${names.map((n,i)=>`<a href="#d${i}">${escape(n)}</a>`).join('')}</nav><p>图源 Markdown SHA256：<code>${report.sourceSha256}</code></p></header>
<main>${sections}</main><footer>单文件离线静态图册；不加载第三方网络资源。由本机 Mermaid ${escape(version)} 生成 SVG。<details><summary>Mermaid MIT License</summary><pre>${escape(license)}</pre></details></footer></body></html>\n`;
  const gallery=path.join(root,'授权中心.图示.html');
  await fs.writeFile(gallery,html);
  await p.close();
  const q=await context.newPage();
  await q.goto(require('node:url').pathToFileURL(gallery).href);
  assert.equal(await q.locator('svg').count(),6);
  await q.screenshot({path:path.join(__dirname,'diagrams-desktop.png')});
  await q.setViewportSize({width:390,height:844});
  assert.ok(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  report.galleryLocalOpen='通过';report.galleryNarrowViewport='通过';
  await browser.close();
  report.summary={parsedAndRendered:6,failed:0};
  report.limitations=['SVG 图册为静态快照，不随离线编辑工作台自动更新。','生成解析和渲染验证不等于业务状态正确性或业务测试。'];
  await fs.writeFile(path.join(__dirname,'diagram-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.summary));
}
main().catch(async e=>{if(activeBrowser)await activeBrowser.close();console.error(e);process.exitCode=1;});
