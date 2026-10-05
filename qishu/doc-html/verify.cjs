/** Exercise the delivered file:// artifact with all network requests blocked.
 * Set PLAYWRIGHT_MODULE to an installed Playwright module if it is not local.
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, offline: true });
  const page = await context.newPage();
  const errors = [], network = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const close = async () => { if (await page.locator('#detail').evaluate(e => e.open)) await page.locator('[data-close="detail"]').click(); };
  await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
  await page.waitForFunction(() => window.atlasReady === true, { timeout: 120000 });
  check('file:// offline boot', await page.locator('.hero').isVisible());
  for (const [width, height] of [[1440,900],[1600,1000],[1920,1080],[2048,1320],[390,844]]) {
    await page.setViewportSize({ width, height });
    check(`no horizontal overflow ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(__dirname, 'preview-overview.png'), fullPage: true, animations: 'disabled' });
  await page.locator('.nav-item[data-nav="flows"]').click();
  await page.locator('[data-flow="message"]').click();
  await page.locator('[data-step="3"]').first().click();
  check('flow steps update', (await page.locator('.step-card h2').innerText()).includes('构造请求'));
  await page.locator('.question summary').click();
  check('question answer expands', await page.locator('.question').evaluate(e=>e.open));
  await page.locator('[data-read]').click();
  check('reading progress persists', (await page.locator('[data-read]').innerText()).includes('已读'));
  await page.locator('.code-caption [data-file]').click();
  check('source opens at correct line', await page.locator('.code-line.highlight').count() === 1);
  await page.locator('#line-input').fill('529');
  await page.locator('[data-jump-line]').click();
  check('source line jump', (await page.locator('.code-line.highlight').innerText()).includes('529'));
  await page.locator('[data-bookmark]').click();
  check('source bookmark', (await page.locator('[data-bookmark]').innerText()).includes('已收藏'));
  await close();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(__dirname, 'preview-flow.png'), fullPage: true, animations: 'disabled' });
  await page.locator('.nav-item[data-nav="packages"]').click();
  await page.locator('#pkg-q').fill('agent-loop');
  await page.waitForTimeout(300);
  check('package search', await page.locator('.package-card').count() >= 1);
  await page.locator('.package-card[data-package="@deepseek-ai/dsh-agent-loop"]').click();
  check('Chinese package documentation', (await page.locator('.markdown').innerText()).includes('创建全新 agent'));
  await page.locator('[data-pkg-tab="deps"]').click();
  check('dependency browser', await page.locator('.imports [data-package]').count() > 0);
  await page.locator('.imports [data-package]').first().click();
  check('dependency navigation', await page.locator('[data-modal-back]').count() === 1);
  await page.locator('[data-modal-back]').click();
  check('modal back navigation', (await page.locator('.detail-title').innerText()).includes('agent-loop'));
  await close();
  await page.locator('.nav-item[data-nav="source"]').click();
  await page.locator('#src-q').fill('private async prepareRequest');
  await page.locator('#src-full').check();
  await page.waitForTimeout(400);
  check('source full-text search', await page.locator('.source-row').count() >= 1);
  await page.locator('.nav-item[data-nav="history"]').click();
  await page.locator('.commit-card').first().waitFor();
  check('history pagination initial', await page.locator('.commit-card').count() === 30);
  const first = await page.locator('.commit-card').first().getAttribute('data-commit');
  await page.locator('[data-page-kind="history"][data-index="1"]').click();
  check('history next page', first !== await page.locator('.commit-card').first().getAttribute('data-commit'));
  await page.locator('#hist-q').fill(await page.evaluate(() => D.meta.head.slice(0, 10)));
  await page.waitForTimeout(300);
  check('commit hash search', await page.locator('.commit-card').count() === 1);
  await page.locator('.commit-card').click();
  check('commit details', (await page.locator('#detail-content').innerText()).includes('第一父提交') || await page.locator('.file-detail').count() > 0);
  await close();
  await page.locator('[data-clear-history]').click();
  await page.locator('#hist-kind').selectOption('feat');
  check('history kind filter', await page.locator('.commit-card').count() > 0);
  await page.screenshot({ path: path.join(__dirname, 'preview-history.png'), animations: 'disabled' });
  await page.keyboard.press('Control+k');
  await page.locator('#omni').fill('ui-brand');
  await page.waitForTimeout(300);
  check('global search', await page.locator('.search-result').count() > 0);
  await page.keyboard.press('Escape');
  await page.locator('#theme').click();
  check('dark theme', await page.locator('html').getAttribute('data-theme') === 'dark');
  await page.locator('#motion').click();
  check('reduced motion', await page.locator('html').getAttribute('data-motion') === 'off');
  for (const name of ['concepts','custom','about']) {
    await page.locator(`.nav-item[data-nav="${name}"]`).click();
    check(`section ${name}`, await page.locator('main h1').count() === 1);
  }
  await page.locator('.nav-item[data-nav="flows"]').click();
  await page.locator('[data-diagram]').click();
  await page.frameLocator('iframe').locator('svg').first().waitFor({ timeout: 30000 });
  check('embedded offline diagram', await page.frameLocator('iframe').locator('svg').count() > 0);
  await close();
  const diagramPage = await context.newPage();
  diagramPage.on('pageerror', e=>errors.push(e.message));
  diagramPage.on('request', r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await diagramPage.goto(pathToFileURL(path.join(__dirname,'runtime-map.html')).href);
  for(const [width,height] of [[1440,900],[1600,1000],[1920,1080],[2048,1320]]) {
    await diagramPage.setViewportSize({width,height});
    await diagramPage.waitForTimeout(180);
    check(`standalone diagram fits ${width}x${height}`,await diagramPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight));
    if(width===2048)await diagramPage.screenshot({path:path.join(__dirname,'preview-diagram.png'),animations:'disabled'});
  }
  await diagramPage.close();
  await page.setViewportSize({width:390,height:844});
  for(const section of ['overview','flows','packages','source','concepts','custom','history','about']) {
    await page.evaluate(s=>location.hash='#'+s,section);
    await page.waitForTimeout(220);
    check(`mobile width containment ${section}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  // All declared source and documentation targets must exist in the payload.
  check('guide targets embedded', await page.evaluate(() => {
    const targets = [...D.guide.flows.flatMap(f=>f.steps.map(s=>s.file)),...D.guide.concepts.map(c=>c.file),...D.guide.customizations.map(c=>c.doc).filter(Boolean),...D.guide.layers.map(l=>l.file)];
    return targets.every(f=>typeof D.files[f]==='string');
  }));
  check('all package Chinese READMEs', await page.evaluate(() => D.packages.every(p=>D.files[p.readme] && /[\u4e00-\u9fff]/.test(p.summary))));
  check('all commits have Chinese summaries', await page.evaluate(() => D.commits.length === D.meta.commitCount && D.commits.every(c=>/[\u4e00-\u9fff]/.test(c.zh))));
  if (network.length || errors.length) console.log(JSON.stringify({network,errors}));
  check('no external requests', network.length === 0);
  check('no browser exceptions', errors.length === 0);
  fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,network,errors},null,2)+'\n');
  await browser.close();
  console.log(JSON.stringify({passed:checks.length,network,errors},null,2));
})().catch(error=>{console.error(error);process.exit(1);});
