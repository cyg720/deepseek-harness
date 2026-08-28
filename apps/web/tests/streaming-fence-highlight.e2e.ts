/** Keyless assembled-Web evidence for syntax highlighting during a streamed code fence.
 * @remarks 文件说明：文件职责：验证 apps/web 中 streaming fence highlight e2e 相关行为与失败场景。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

/**
 * 常量说明：SNAPSHOT_DIR 用于处理 SNAPSHOT_DIR 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/streaming-fence-highlight', import.meta.url))
/**
 * 常量说明：MID_EXPECTED 用于处理 MID_EXPECTED 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const MID_EXPECTED = fileURLToPath(new URL('./snapshots/streaming-fence-highlight/mid-stream.expected.md', import.meta.url))
/**
 * 常量说明：MODE 用于处理 MODE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODE = webSnapshotMode()
/**
 * 常量说明：PROVIDER 用于处理 PROVIDER 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PROVIDER = 'streaming-fence-highlight-test'
/**
 * 常量说明：MODEL 用于处理 MODEL 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODEL = 'streaming-fence'
/**
 * 常量说明：PROMPT 用于处理 PROMPT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PROMPT = 'Stream one TypeScript fence for the highlighting snapshot.'
/**
 * 常量说明：OPEN_REPLY 用于打开 REPLY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const OPEN_REPLY = '```ts\nconst first: number = 1\nconst second = "two"\nlet tail'
/**
 * 常量说明：REPLY 用于处理 REPLY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const REPLY = `${OPEN_REPLY}\n\`\`\``

/** Deterministic model response held after the visible fence body arrives.
 * @remarks 中文说明：类说明：StreamingFenceAdapter 用于集中封装 处理 StreamingFenceAdapter
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 apps/web
 * 在对应插件或业务生命周期内创建和调用。 */
class StreamingFenceAdapter extends LlmAdapter {
  /**
   * 变量说明：resolvePaused 用于解析 Paused 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private resolvePaused!: () => void
  /**
   * 变量说明：resolveContinuation 用于解析 Continuation 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private resolveContinuation!: () => void
  /**
   * 变量说明：continued 用于处理 continued 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private continued = false
  /**
   * 常量说明：paused 用于处理 paused 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly paused = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { this.resolvePaused = resolve })
  /**
   * 常量说明：continuation 用于处理 continuation 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly continuation = new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { this.resolveContinuation = resolve })

  /**
   * 功能说明：处理 continue 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 continue()，并按返回类型处理结果。
   */
  continue(): void {
    if (this.continued) return
    this.continued = true
    this.resolveContinuation()
  }

  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （GenerateOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<StreamChunk>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(options)，并按返回类型处理结果。
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: OPEN_REPLY }
    this.resolvePaused()
    await this.continuation
    if (options.signal?.aborted === true) throw options.signal.reason
    yield { type: 'text-delta', index: 0, text: '\n```' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface FenceTree {
  language: string
  pre: { className: string; style: string | null; tabIndex: string | null }
  lines: { text: string; style: string | null }[][]
}

/** Read the stable, user-visible subset of one rendered code fence.
 * @remarks 中文说明：功能说明：处理 fenceTree 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：block（ReturnType<Page['locator']>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<FenceTree>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * fenceTree(block)，并按返回类型处理结果。 */
async function fenceTree(block: ReturnType<Page['locator']>): Promise<FenceTree> {
  return await block.evaluate(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：element（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(element)，并按返回类型处理结果。
 */ (element) => {
    /**
     * 常量说明：pre 用于处理 pre 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const pre = element.querySelector<HTMLPreElement>('pre.shiki')
      if (pre === null) throw new Error('streaming fence did not render through the shiki arm')
      return {
        language: element.querySelector('[class*="infostring"]')?.textContent ?? '',
        pre: {
          className: pre.className,
          style: pre.style.cssText,
          tabIndex: pre.getAttribute('tabindex'),
        },
        lines: [...pre.querySelectorAll('.line')].map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
 */ line =>
            [...line.querySelectorAll('span')].map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
 */ span => ({
                text: span.textContent ?? '',
                style: span.style.cssText,
              })),
        ),
      }
    })
}

describe.skipIf(MODE === 'record')('web e2e: streaming code-fence highlighting', /*
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
   * 常量说明：adapter 用于处理 adapter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const adapter = new StreamingFenceAdapter()

    beforeAll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        scaffold = await launchWebScaffold()
        scaffold.ctx.effect(
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => scaffold.ctx.llm.registerAdapter([PROVIDER], adapter),
          'streaming fence highlight adapter',
        )
        await scaffold.ctx.agentDefaultModel.saveSelection({ provider: PROVIDER, model: MODEL })
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
        adapter.continue()
        await browser?.close()
        await scaffold?.close()
      })

    it('renders the growing fence through shiki and preserves its token tree when the turn settles', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        onTestFailed(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => saveFailureShot(page, 'web-e2e-streaming-fence-highlight'))
        /**
     * 常量说明：input 用于处理 input 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const input = page.locator('[data-composer-input]').first()
        /**
     * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const settled = scaffold.whenTurnSettled(30_000)
        await writeComposerDraft(page, input, PROMPT)
        await input.press('Enter')
        await adapter.paused

        /**
     * 常量说明：streaming 用于处理 streaming 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const streaming = page.locator('[data-streaming="true"]')
        await streaming.waitFor({ timeout: 10_000 })
        /**
     * 常量说明：block 用于处理 block 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const block = streaming.locator('.md-code-block').filter({ hasText: 'const first' })
        await block.locator('pre.shiki span[style]').first().waitFor({ timeout: 10_000 })
        /**
     * 常量说明：midTree 用于处理 midTree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const midTree = await fenceTree(block)
        expect(midTree.language).toBe('ts')
        expect(midTree.lines).toHaveLength(3)
        expect(midTree.lines.flat().map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：span（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(span)，并按返回类型处理结果。
 */ span => span.style)).toContain('color: var(--shiki-token-keyword);')

        /**
     * 常量说明：aria 用于处理 aria 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const aria = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
        await compareOrRefreshGolden(
          MID_EXPECTED,
          `${aria}\n\n---\n\n${JSON.stringify(midTree, null, 2)}`,
          MODE,
        )

        adapter.continue()
        await settled
        await expect.poll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => page.locator('[data-streaming="true"]').count(), { timeout: 10_000 }).toBe(0)
        /**
     * 常量说明：settledBlock 用于处理 settledBlock 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const settledBlock = page.locator('.md-code-block').filter({ hasText: 'const first' })
        await settledBlock.locator('pre.shiki').waitFor({ timeout: 10_000 })
        expect(await fenceTree(settledBlock)).toEqual(midTree)
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
        await assertFixtureInventory(SNAPSHOT_DIR, ['mid-stream.expected.md'])
      }, 60_000)
  })
