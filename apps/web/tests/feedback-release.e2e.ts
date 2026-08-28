// Keyless assembled-browser coverage for the shipped FEEDBACK_ONLY default
// over the Web bundles and the real host wire. The scaffold mounts the
// shipped telemetry row in FEEDBACK_ONLY mode against this suite's own
// loopback mock collector, so the default release path is real: /feedback
// releases the session records through that event (exactly one OTLP request,
// carrying the drive prompt and the feedback text), the acknowledgement pins
// the feedback-gated disclosure sentence, and a second feedback releases only
// the records since the first handoff — the earlier prompt does not repeat.
/**
 * 文件职责：验证 apps/web 中 feedback release e2e 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { gunzipSync } from 'node:zlib'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureExpandedTurnProcessAria, captureStableAria,
  compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/**
 * 常量说明：SNAPSHOT_DIR 用于处理 SNAPSHOT_DIR 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/feedback-release', import.meta.url))
// The release path needs only a settled ordinary turn, so this lane replays
// the feedback-command scenario's recorded session (declared as this
// manifest's `session.source`) instead of recording a duplicate.
/**
 * 常量说明：FIXTURE 用于处理 FIXTURE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/feedback-command/session.jsonl', import.meta.url))
/**
 * 常量说明：ACK_EXPECTED 用于处理 ACK_EXPECTED 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const ACK_EXPECTED = join(SNAPSHOT_DIR, 'ack.expected.md')
/**
 * 常量说明：ACK_EXPANDED_EXPECTED 用于处理 ACK_EXPANDED_EXPECTED 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ACK_EXPANDED_EXPECTED = join(SNAPSHOT_DIR, 'ack-expanded.expected.md')
/**
 * 常量说明：MODE 用于处理 MODE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODE = webSnapshotMode()

/**
 * 常量说明：PROMPT 用于处理 PROMPT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe('web e2e: feedback-gated release under the shipped default mode', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
  /**
   * 变量说明：scaffold 用于处理 scaffold 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
    let scaffold: WebScaffold
    /**
   * 变量说明：browser 用于处理 browser 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
    let browser: Browser
    /**
   * 变量说明：page 用于处理 page 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
    let page: Page
    /**
   * 变量说明：tripwire 用于处理 tripwire 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
    let tripwire: ReturnType<typeof watchConsole>
    /**
   * 变量说明：collector 用于处理 collector 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
    let collector: Server
    /**
   * 常量说明：uploads 用于处理 uploads 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const uploads: string[] = []

    beforeAll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        collector = createServer(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, response)，
 * 并按返回类型处理结果。
 */ (request, response) => {
            /**
       * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
            const chunks: Buffer[] = []
            request.on('data', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
 */ chunk => chunks.push(chunk as Buffer))
            request.on('end', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
                /**
         * 常量说明：raw 用于处理 raw 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
                const raw = Buffer.concat(chunks)
                uploads.push((request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString())
                response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
              })
          })
        collector.listen(0, '127.0.0.1')
        await once(collector, 'listening')
        /**
     * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const address = collector.address()
        if (address === null || typeof address === 'string') throw new Error('collector has no port')
        scaffold = await launchWebScaffold({
          telemetryUrl: `http://127.0.0.1:${address.port}/v1/logs`,
          telemetryMode: 'FEEDBACK_ONLY',
          // The replayed session.jsonl belongs to the feedback-command scenario;
          // comparing (or refreshing) the persisted session here would rewrite
          // that shared source with this lane's feedback events. The release
          // evidence lives in this lane's golden and collector assertions.
          compareReplaySession: false,
          ...(MODE === 'record' ? {} : { replayFixture: FIXTURE }),
        })
        browser = await chromium.launch()
        page = await newEnglishPage(browser)
        tripwire = watchConsole(page)
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
        await connectFreshWorkspace(page, scaffold.workspaceCwd)
      }, 120_000)

    afterAll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        await browser?.close()
        await scaffold?.close()
        collector?.close()
        collector?.closeAllConnections()
      })

    it('drives the recorded prompt to a settled turn (all modes)', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        onTestFailed(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => saveFailureShot(page, 'web-e2e-feedback-release-drive'))
        if (MODE !== 'record') {
          // Drift guard: the shared fixture must carry exactly the drive prompt.
          expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
        }
        /**
     * 常量说明：input 用于处理 input 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const input = page.locator('[data-composer-input]').first()
        await input.waitFor({ timeout: 10_000 })
        /**
     * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const settled = scaffold.whenTurnSettled()
        await input.fill(PROMPT)
        await input.press('Enter')
        /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sessionId = await settled
        if (MODE === 'record') {
          // Re-records the SHARED feedback-command session this lane replays.
          await recordFixture(scaffold, sessionId, FIXTURE)
        }
      }, 60_000)

    it.skipIf(MODE === 'record')('releases the session records through the feedback and pins the disclosure', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        onTestFailed(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => saveFailureShot(page, 'web-e2e-feedback-release'))
        await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
        expect(uploads).toEqual([])
        /**
     * 常量说明：input 用于处理 input 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const input = page.locator('[data-composer-input]').first()
        await input.fill('/feedback the diff view is unreadable')
        await input.press('Enter')

        await page.getByText(/Feedback recorded for session/).waitFor({ timeout: 10_000 })
        expect(await page.getByText(/recording feedback uploads the session records not yet shared/).count()).toBe(1)

        // FEEDBACK_ONLY releases through the committed feedback event: exactly
        // one request reaches the collector, carrying the whole unshared range.
        await expect.poll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => uploads.length, { timeout: 15_000 }).toBe(1)
        expect(uploads[0]).toContain('the diff view is unreadable')
        expect(uploads[0]).toContain(PROMPT)

        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
        await compareOrRefreshGolden(ACK_EXPECTED, snapshot, MODE)
        /**
     * 常量说明：expanded 用于处理 expanded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const expanded = await captureExpandedTurnProcessAria(
          page,
          '[class*="centerCol"]',
          scaffold.workspaceCwd,
        )
        await compareOrRefreshGolden(ACK_EXPANDED_EXPECTED, expanded, MODE)
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
      }, 60_000)

    it.skipIf(MODE === 'record')('releases only the records since the last handoff on a second feedback', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        onTestFailed(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => saveFailureShot(page, 'web-e2e-feedback-release-suffix'))
        /**
     * 常量说明：input 用于处理 input 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const input = page.locator('[data-composer-input]').first()
        await input.fill('/feedback the second remark')
        await input.press('Enter')
        await expect.poll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => uploads.length, { timeout: 15_000 }).toBe(2)
        // Suffix semantics: the second release starts after the first feedback's
        // handoff, so the drive prompt already shared must not repeat.
        expect(uploads[1]).toContain('the second remark')
        expect(uploads[1]).not.toContain(PROMPT)
      }, 60_000)

    it.skipIf(MODE === 'record')('keeps the fixture inventory closed', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        await assertFixtureInventory(SNAPSHOT_DIR, ['ack.expected.md', 'ack-expanded.expected.md'])
      })
  })
