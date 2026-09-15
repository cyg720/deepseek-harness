const { chromium } = require('C:/Users/18010/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/18010/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.setOffline(true);
  const page = await context.newPage();
  const errors = [];
  const network = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  const checks = [];
  try {
    await page.goto(pathToFileURL(path.resolve(__dirname, '../../授权中心.prd.html')).href);
    await page.waitForFunction(() => document.querySelectorAll('.diagram-view svg').length === 5);
    checks.push('五张现行流程与状态图离线渲染');
    const current = await page.locator('#article').innerText();
    assert.ok(current.includes('0.4.2') && current.includes('剩余不足15天') && current.includes('超级管理员') && current.includes('90天'));
    assert.ok(current.includes('不额外构造应用A向应用B转授权限的链'));
    checks.push('反馈后版本与鉴权规则显示');
    const toc = page.locator('#toc a').filter({ hasText: '12.1 逐项决定、落实与剩余问题' });
    await toc.click();
    assert.equal(await page.evaluate(() => document.activeElement.id), await toc.getAttribute('data-toc'));
    await page.screenshot({ path: path.join(__dirname, 'decisions-desktop.png') });
    checks.push('反馈章节目录定位和桌面显示');
    const download = page.waitForEvent('download');
    await page.locator('#exportHtmlBtn').click();
    const exported = path.join(__dirname, 'roundtrip.html');
    await (await download).saveAs(exported);
    const second = await context.newPage();
    second.on('pageerror', error => errors.push(String(error)));
    await second.goto(pathToFileURL(exported).href);
    await second.waitForFunction(() => document.querySelectorAll('.diagram-view svg').length === 5);
    const snapshot = async target => JSON.parse(await target.locator('#prd-data').textContent());
    assert.deepEqual(await snapshot(page), await snapshot(second));
    checks.push('导出HTML重开后正文与版本完整一致');
    await page.locator('#toc a').filter({ hasText: '一图统揽' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, 'mobile.png') });
    assert.equal(await page.locator('.diagram-view svg').count(), 5);
    checks.push('窄屏阅读仍保留五张图');
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: path.join(__dirname, 'print.png') });
    checks.push('打印样式可呈现');
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    checks.push('无脚本异常及外部网络请求');
    await fs.writeFile(path.join(__dirname, 'browser-report.json'), JSON.stringify({ passed: checks.length, checks, browser: browser.version(), businessExecution: '未执行；文档浏览器检查' }, null, 2) + '\n');
    console.log(`${checks.length} checks passed`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
