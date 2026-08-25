/**
 * Opt-in browser stress reproduction for reasoning-stream renderer stalls.
 * The fixture emits 100,000 individual chunks through the normal async
 * carrier; the test measures event-loop and scheduled-interaction delay while
 * the assembled React surface keeps a collapsed Think row live.
 */
/*
 * 文件职责：通过十万条推理增量重现并测量浏览器渲染期间的主线程卡顿。
 * 技术维度：使用 Playwright、Vitest 轮询、浏览器 Performance API 和真实 Web 测试脚手架。
 * 产品维度：保证长推理流持续到达时，聊天界面仍能响应计时器和用户交互。
 * 逻辑维度：启动页面和心跳探针，触发增量风暴，等待渲染完成，汇总延迟并断言预算。
 * 关键边界：该压力测试默认按需运行，最长十分钟；无论成功失败都必须关闭浏览器和服务。
 * 新手阅读建议：先看四个压力参数，再读页面内探针，最后理解 report 的两项延迟断言。
 */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from '../tests/scaffold.ts'
import { newEnglishPage, saveFailureShot } from '../tests/support.ts'

/** 单次压力测试要发送的推理增量总数。 */
const CHUNK_COUNT = 100_000
/** 每个发送间隔批量推送的增量数量。 */
const CHUNKS_PER_INTERVAL = 128
/** 两批增量之间的目标间隔，单位毫秒。 */
const CHUNK_INTERVAL_MS = 16
/** 心跳或计划交互可接受的最大主线程额外延迟。 */
const MAIN_THREAD_DELAY_BUDGET_MS = 250

/** 浏览器夹具公开的推理增量风暴当前状态。 */
interface ReasoningChunkStormState {
  sessionId: string
  chunkCount: number
  chunksPerInterval: number
  intervalMs: number
  emitted: number
  marker: string
  emitting: boolean
}

/** 注入页面的心跳与交互延迟探针。 */
interface StressProbe {
  intervalId: number
  intervalMs: number
  lastTickAt: number
  maxDelayMs: number
  samples: number
  interactionDueAt: number
  interactionHandledAt: number | null
}

/** 扩展浏览器 Window，声明压力夹具与探针挂载点。 */
interface StressWindow extends Window {
  /** 由 fixture 页面提供的增量风暴控制接口。 */
  __fxTiming?: {
    /** 启动指定会话的增量风暴并返回最终标记文本。 */
    startReasoningChunkStorm(id: string, chunkCount: number, chunksPerInterval: number, intervalMs: number): string
    /** 返回当前增量风暴状态，尚未启动时为 null。 */
    reasoningChunkStormState(): ReasoningChunkStormState | null
  }
  /** 本测试注入的主线程响应性探针。 */
  __reasoningStressProbe?: StressProbe
}

/** 十万条推理增量渲染期间，心跳与计划交互延迟必须保持在预算内。 */
it('keeps the browser responsive while rendering 100,000 reasoning chunks', async () => {
  /** 本测试启动的 Web 服务脚手架。 */
  let scaffold: WebScaffold | undefined
  /** 本测试启动的 Chromium 浏览器。 */
  let browser: Browser | undefined
  /** 执行压力交互的浏览器页面。 */
  let page: Page | undefined
  try {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch({ headless: process.env.DSH_WEB_STRESS_HEADFUL !== '1' })
    page = await newEnglishPage(browser)
    /** 初始化完成后保持非空的活动页面引用。 */
    const activePage = page
    await activePage.addInitScript(() => {
      localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'fx-alpha' }))
    })
    /** 收集页面错误和控制台警告的监视器。 */
    const tripwire = watchConsole(activePage)
    onTestFailed(() => saveFailureShot(activePage, 'web-stress-reasoning-chunks'))
    await activePage.goto(`${scaffold.baseUrl}?fixture`, { waitUntil: 'load' })
    await activePage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Fixture settings deliberately reject writes, so its welcome notice
    // cannot acknowledge. Hide only that test overlay; the assembled chat
    // tree beneath it remains mounted and exercises the production renderer.
    // 夹具设置拒绝写入，欢迎层无法确认；仅隐藏该覆盖层，底下真实聊天树继续参与压力渲染。
    await activePage.addStyleTag({ content: '[class*="onboardingOverlay"] { display: none !important; }' })
    await activePage.locator('[data-sample="bash"]').first().waitFor({ timeout: 30_000 })

    await activePage.evaluate(() => {
      /** 心跳检查间隔，单位毫秒。 */
      const intervalMs = 50
      /** 安装探针时的高精度时间。 */
      const now = performance.now()
      /** 记录最大事件循环延迟和计划交互处理时间的页面内探针。 */
      const probe: StressProbe = {
        intervalId: 0,
        intervalMs,
        lastTickAt: now,
        maxDelayMs: 0,
        samples: 0,
        interactionDueAt: now + 1_000,
        interactionHandledAt: null,
      }
      probe.intervalId = window.setInterval(() => {
        /** 当前心跳实际执行的高精度时间。 */
        const tickAt = performance.now()
        probe.maxDelayMs = Math.max(probe.maxDelayMs, tickAt - probe.lastTickAt - intervalMs)
        probe.lastTickAt = tickAt
        probe.samples++
      }, intervalMs)
      document.body.addEventListener('reasoning-stress-interaction', () => {
        probe.interactionHandledAt = performance.now()
      }, { once: true })
      window.setTimeout(() => {
        document.body.dispatchEvent(new CustomEvent('reasoning-stress-interaction'))
      }, 1_000)
      ;(window as StressWindow).__reasoningStressProbe = probe
    })

    /** 增量风暴结束时应出现在推理行中的唯一标记。 */
    const marker = await activePage.evaluate(({ chunkCount, chunksPerInterval, intervalMs }) => {
      /** fixture 页面提供的压力控制接口。 */
      const hooks = (window as StressWindow).__fxTiming
      if (hooks === undefined) throw new Error('reasoning stress fixture hooks unavailable')
      return hooks.startReasoningChunkStorm('fx-alpha', chunkCount, chunksPerInterval, intervalMs)
    }, {
      chunkCount: CHUNK_COUNT,
      chunksPerInterval: CHUNKS_PER_INTERVAL,
      intervalMs: CHUNK_INTERVAL_MS,
    })

    /** 当前运行中的最后一个折叠推理行。 */
    const liveThink = activePage.locator('[data-variant="think"][data-state="running"]').last()
    await liveThink.waitFor({ timeout: 60_000 })
    await expect.poll(async () => await activePage.evaluate(() => {
      const hooks = (window as StressWindow).__fxTiming
      return hooks?.reasoningChunkStormState()?.emitted ?? 0
    }), { timeout: 540_000, interval: 100 }).toBe(CHUNK_COUNT)
    await expect.poll(() => liveThink.textContent(), { timeout: 60_000, interval: 100 }).toContain(marker)

    /** 页面内探针和风暴状态汇总出的压力报告。 */
    const report = await activePage.evaluate(() => {
      /** 带压力测试扩展字段的页面窗口。 */
      const win = window as StressWindow
      /** 已安装的主线程延迟探针。 */
      const probe = win.__reasoningStressProbe
      /** 增量风暴的最终发送状态。 */
      const state = win.__fxTiming?.reasoningChunkStormState()
      if (probe === undefined || state === undefined || state === null) {
        throw new Error('reasoning stress metrics unavailable')
      }
      window.clearInterval(probe.intervalId)
      /** 计划交互相对目标时刻的实际延迟；未处理时为 null。 */
      const interactionDelayMs = probe.interactionHandledAt === null
        ? null
        : probe.interactionHandledAt - probe.interactionDueAt
      return {
        chunkCount: state.chunkCount,
        chunksPerInterval: state.chunksPerInterval,
        intervalMs: state.intervalMs,
        emitted: state.emitted,
        maxMainThreadDelayMs: Math.max(0, probe.maxDelayMs),
        interactionDelayMs,
        heartbeatSamples: probe.samples,
      }
    })
    process.stdout.write(`reasoning-chunk stress report: ${JSON.stringify(report)}\n`)

    expect(report).toMatchObject({
      chunkCount: CHUNK_COUNT,
      chunksPerInterval: CHUNKS_PER_INTERVAL,
      intervalMs: CHUNK_INTERVAL_MS,
      emitted: CHUNK_COUNT,
    })
    expect(report.heartbeatSamples).toBeGreaterThan(0)
    /** 已确认不为 null 的计划交互延迟。 */
    const interactionDelayMs = report.interactionDelayMs
    if (interactionDelayMs === null) throw new Error(`scheduled interaction was not handled: ${JSON.stringify(report)}`)
    expect(report.maxMainThreadDelayMs, JSON.stringify(report)).toBeLessThan(MAIN_THREAD_DELAY_BUDGET_MS)
    expect(interactionDelayMs, JSON.stringify(report)).toBeLessThan(MAIN_THREAD_DELAY_BUDGET_MS)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  } finally {
    await browser?.close()
    await scaffold?.close()
  }
}, 600_000)
