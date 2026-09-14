/** Verify the offline report in an isolated headless Edge process. */
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))
const repository = resolve(directory, '../../../..')
const requireWeb = createRequire(join(repository, 'apps/web/package.json'))
const { chromium } = requireWeb('playwright')
const reportPath = resolve(directory, '../桌面端技术分析.html')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const results = { pageErrors: [], networkRequests: [], views: [], links: 0, chapters: 0 }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => results.pageErrors.push(error.message))
  page.on('request', request => {
    if (/^https?:/.test(request.url())) results.networkRequests.push(request.url())
  })
  await page.goto(pathToFileURL(reportPath).href)
  await page.evaluate(() => document.fonts.ready)
  results.chapters = await page.locator('section.chapter').count()
  results.links = await page.locator('a').count()
  const missingFragments = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')]
    .filter(a => !document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))))
    .map(a => a.getAttribute('href')))
  if (missingFragments.length) throw new Error(`Missing anchors: ${missingFragments.join(', ')}`)
  await page.screenshot({ path: join(directory, 'report-desktop.png') })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.getBoundingClientRect().width }))
    results.views.push(metrics)
    if (metrics.scrollWidth > width + 1) throw new Error(`Horizontal page overflow at ${width}px`)
  }
  await page.screenshot({ path: join(directory, 'report-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.locator('#chapter-4').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(directory, 'report-packaging.png') })
  await page.getByRole('button', { name: '切换明暗' }).click()
  if (!(await page.locator('body').evaluate(body => body.classList.contains('dark')))) {
    throw new Error('Theme control failed')
  }
  if (results.chapters !== 7 || results.pageErrors.length || results.networkRequests.length) {
    throw new Error('Reader verification failed')
  }
  results.passed = true
} finally {
  await browser.close()
  await writeFile(join(directory, 'browser-validation.json'), `${JSON.stringify(results, null, 2)}\n`)
}
console.log(JSON.stringify(results, null, 2))
