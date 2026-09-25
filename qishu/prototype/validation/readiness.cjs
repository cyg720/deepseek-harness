/* 静态原型验收自有随机端口和隔离浏览器上下文；不访问运行中的产品服务。 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
(async () => {
  const server = http.createServer(async (req, res) => {
    const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try { const body = await fs.readFile(target); res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }).end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [], network = [], screenshots = [];
  let states = 0, diagnosticStates = 0;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (['fetch', 'xhr'].includes(req.resourceType())) network.push(req.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('[data-action=fill-demo]').click();
    await page.locator('#login-form button[type=submit]').click();
    await page.locator('#prompt').fill('原会话草稿保留');
    await page.locator('#toast').evaluate(el => el.classList.remove('visible'));
    await page.locator('[data-action=interaction-demo]').click();
    await page.locator('[data-wb-open=inspector]').click();
    const groups = await page.locator('#wb-group option').evaluateAll(els => els.map(x => x.value));
    for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForFunction(() => layoutMode === viewportMode());
      await page.evaluate(t => { state.settings.theme = t; renderApp(); }, theme);
      for (const group of groups) {
        await page.locator('#wb-group').selectOption(group);
        for (const mode of await page.locator('#wb-mode option').allTextContents()) {
          await page.locator('#wb-mode').selectOption(mode);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${group}/${mode}/${width} 页面溢出`);
          assert.equal(await page.locator('.wb-content').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${group}/${mode}/${width} 内容溢出`);
          states++;
        }
      }
      await page.locator('#wb-group').selectOption('trajectory');
      await page.locator('#wb-mode').selectOption('提问到达');
      const shot = `readiness-pending-${width}-${theme}.png`;
      await page.screenshot({ path: path.join(root, 'preview', shot) }); screenshots.push(shot);
    }
    await page.locator('[data-ready-field=answerText]').fill('保留补充说明');
    await page.locator('[data-wb=chat-view]').click();
    assert.equal(await page.locator('[data-ready-pending]').count(), 1);
    assert.equal(await page.locator('[data-ready-field=answerText]').inputValue(), '保留补充说明');
    await page.locator('[data-wb=trace-view]').click();
    await page.locator('#wb-mode').selectOption('回答失败');
    await page.locator('[data-ready=answer]').click();
    assert.equal(await page.locator('[data-ready-field=answerText]').inputValue(), '保留补充说明');
    await page.locator('#wb-mode').selectOption('断线');
    assert.equal(await page.locator('[data-ready=answer]').isDisabled(), true);
    await page.locator('#wb-mode').selectOption('结构化草稿');
    assert.equal(await page.locator('[data-ready=send-demo]').isDisabled(), true);
    await page.locator('#wb-mode').selectOption('官方入口关闭');
    assert.equal(await page.locator('[data-ready=official-draft]').count(), 0);
    await page.locator('#wb-group').selectOption('inspector');
    for (const viewer of ['Text', 'Markdown', 'HTML', 'Image', 'PDF', 'Code']) {
      await page.locator('[data-ready-field=viewer]').selectOption(viewer);
      assert.match(await page.locator('.wb-content').innerText(), new RegExp(viewer));
      if (viewer === 'HTML') assert.equal(await page.locator('iframe').getAttribute('sandbox'), '');
    }
    await page.locator('[data-ready=preview-close]').click();
    assert.match(await page.locator('.wb-content').innerText(), /视图已关闭/);
    await page.locator('#wb-group').selectOption('settings');
    for (const section of ['通用', '模型与供应商', '插件配置', '插件清单', '权限预设', '模型选择', '代理预设']) {
      await page.locator(`[data-wb-section="${section}"]`).click();
      assert.equal(await page.locator(`[data-wb-section="${section}"]`).getAttribute('aria-selected'), 'true');
    }
    await page.locator('[data-wb-section="模型与供应商"]').click();
    await page.locator('[data-ready-field=baseURL]').fill('https://example.invalid');
    await page.locator('#wb-mode').selectOption('保存失败');
    await page.locator('[data-ready=save-fields]').click();
    assert.equal(await page.locator('[data-ready-field=baseURL]').inputValue(), 'https://example.invalid');
    await page.locator('#wb-mode').selectOption('memory 模式');
    assert.equal(await page.locator('[data-ready=save-fields]').isDisabled(), true);
    await page.locator('#wb-group').selectOption('subagent');
    await page.locator('#wb-mode').selectOption('父级不可用且运行中');
    assert.equal(await page.locator('[data-wb=child-stop]').isEnabled(), true);
    await page.locator('#wb-group').selectOption('files');
    await page.locator('[data-ready-field=path]').fill('/workspace/' + 'long/'.repeat(30));
    await page.locator('[data-ready=directory-confirm]').click();
    assert.match(await page.locator('#wb-status').innerText(), /原工作区未变/);
    await page.locator('#wb-group').selectOption('feedback');
    await page.locator('[data-ready=like]').click();
    await page.locator('[data-ready=retract]').click();
    assert.equal(await page.locator('[data-ready=retract]').isDisabled(), true);
    await page.locator('#wb-group').selectOption('layout');
    await page.locator('[data-ready="close:会话"]').click();
    assert.equal(await page.locator('[data-ready="reopen:会话"]').count(), 1);
    await page.locator('[data-ready="reopen:会话"]').click();
    // 保留原有布局保存、拖拽、授权撤销和目标失败恢复回归，避免字段补稿丢掉已有交互。
    await page.locator('[data-wb=move-2]').click();
    const order = await page.locator('[data-wb-dock]').evaluateAll(els => els.map(el => el.dataset.wbDock));
    assert.deepEqual(order, ['会话', '作业', '检查器']);
    await page.locator('[data-wb=save-layout]').click();
    await page.locator('[data-wb-drag="会话"]').dragTo(page.locator('[data-wb-dock="检查器"]'));
    assert.notDeepEqual(await page.locator('[data-wb-dock]').evaluateAll(els => els.map(el => el.dataset.wbDock)), order);
    await page.locator('#wb-group').selectOption('goal');
    await page.locator('#wb-goal').fill('<img src=x onerror=alert(1)>');
    await page.locator('#wb-mode').selectOption('保存失败');
    await page.locator('[data-wb=save-goal]').click();
    assert.equal(await page.locator('#wb-goal').inputValue(), '<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('.wb-content img').count(), 0);
    await page.locator('[data-wb=clear-goal]').click(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('#wb-goal').inputValue(), '<img src=x onerror=alert(1)>');
    await page.locator('[data-wb=clear-goal]').click(); await page.locator('[data-wb=goal-cleared]').click();
    assert.equal(await page.locator('#wb-goal').inputValue(), '');
    await page.locator('#wb-group').selectOption('integrations');
    assert.equal(await page.locator('[data-wb=protected]').isDisabled(), true);
    await page.locator('[data-wb=authorize]').click(); await page.locator('[data-wb=authorized]').click();
    assert.equal(await page.locator('[data-wb=protected]').isEnabled(), true);
    await page.locator('[data-wb=revoke]').click(); await page.locator('[data-wb=revoked]').click();
    assert.equal(await page.locator('[data-wb=protected]').isDisabled(), true);
    await page.locator('[data-wb=exit]').click();
    assert.equal(await page.locator('#prompt').inputValue(), '原会话草稿保留');
    await page.locator('#toast').evaluate(el => el.classList.remove('visible'));
    await page.locator('[data-action=interaction-demo]').click();
    await page.locator('[data-p2-open=command]').click();
    for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForFunction(() => layoutMode === viewportMode());
      await page.evaluate(t => { state.settings.theme = t; renderApp(); }, theme);
      for (const group of ['tool', 'process', 'retry', 'history', 'queue', 'pressure', 'command']) {
        await page.locator('#p2-group').selectOption(group);
        for (const mode of await page.locator('#p2-mode option').allTextContents()) {
          await page.locator('#p2-mode').selectOption(mode);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${group}/${mode}/${width}`);
          diagnosticStates++;
        }
      }
    }
    await page.locator('#p2-group').selectOption('command');
    await page.locator('#p2-command').fill('/model');
    await page.locator('[data-p2-command="/model"]').click();
    assert.match(await page.locator('#modal').innerText(), /选择模型/);
    await page.locator('[data-p2=cancel]').click();
    await page.locator('#p2-command').fill('/feedback');
    await page.locator('[data-p2-command="/feedback"]').click();
    await page.locator('#p2-feedback-draft').fill('保留反馈');
    await page.locator('[data-p2=feedback-fail]').click();
    assert.equal(await page.locator('#p2-feedback-draft').inputValue(), '保留反馈');
    assert.match(await page.locator('#p2-feedback-error').innerText(), /失败/);
    await page.locator('[data-p2=cancel]').click();
    await page.locator('[data-p2=exit]').click();
    await page.reload();
    if (await page.locator('#login-form').count()) { await page.locator('[data-action=fill-demo]').click(); await page.locator('#login-form button[type=submit]').click(); }
    await page.locator('#toast').evaluate(el => el.classList.remove('visible'));
    await page.locator('[data-action=interaction-demo]').click(); await page.locator('[data-wb-open=layout]').click();
    assert.deepEqual(await page.locator('[data-wb-dock]').evaluateAll(els => els.map(el => el.dataset.wbDock)), order);
    await page.locator('[data-action=new-chat]').click();
    assert.equal(await page.locator('#wb-group').count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    const result = { states, diagnosticStates, groups: groups.length, screenshots, errors, network, scope: '静态原型浏览器验收；不是生产接口或真实登录测试' };
    await fs.writeFile(path.join(__dirname, 'readiness-report.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
