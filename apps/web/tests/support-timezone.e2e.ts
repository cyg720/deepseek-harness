import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { newEnglishPage } from './support.ts'

it.each(['UTC', 'America/Los_Angeles'])('isolates the recorded browser timezone from a %s context', async (hostTimeZone) => {
  const browser = await chromium.launch()
  try {
    // QS 二开：通过 context 的 timezoneId 跨平台控制时区，不依赖 Windows 不一定采用的 TZ 环境变量。
    const ambientContext = await browser.newContext({ timezoneId: hostTimeZone })
    const ambientPage = await ambientContext.newPage()
    expect(await ambientPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(hostTimeZone)

    const page = await newEnglishPage(browser)
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('Asia/Shanghai')
    expect(await page.evaluate(() => navigator.language)).toBe('en-US')
    expect(await ambientPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(hostTimeZone)

    await page.close()
    const nextPage = await ambientContext.newPage()
    expect(await nextPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(hostTimeZone)
  } finally {
    await browser.close()
  }
})
