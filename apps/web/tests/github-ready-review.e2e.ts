/** Keyless assembled-Web evidence for GitHub ready-for-review Session creation.
 * @remarks 文件说明：文件职责：验证 apps/web 中 github ready review e2e 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-webhook'
import {
  captureExpandedTurnProcessAria,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot } from './support.ts'

/**
 * 常量说明：MODE 用于处理 MODE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODE = webSnapshotMode()
/**
 * 常量说明：OVERLAY 用于处理 OVERLAY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const OVERLAY = fileURLToPath(new URL('../../cli/config/examples/github-review/cordis.yml', import.meta.url))
/**
 * 常量说明：EXPECTED 用于处理 EXPECTED 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const EXPECTED = fileURLToPath(new URL('./expected/github-ready-review/conversation.expected.md', import.meta.url))
/**
 * 常量说明：EXPANDED_EXPECTED 用于处理 EXPANDED_EXPECTED 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const EXPANDED_EXPECTED = fileURLToPath(
  new URL('./expected/github-ready-review/conversation-expanded.expected.md', import.meta.url),
)
/**
 * 常量说明：PROVIDER 用于处理 PROVIDER 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PROVIDER = 'github-webhook-review-test'
/**
 * 常量说明：MODEL 用于处理 MODEL 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODEL = 'reply'
/**
 * 常量说明：SECRET 用于处理 SECRET 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SECRET = 'github-webhook-review-secret'
/**
 * 常量说明：TITLE 用于处理 TITLE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const TITLE = 'Review deepseek-harness/deepseek-harness#314'
/**
 * 常量说明：REPLY 用于处理 REPLY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const REPLY = 'Review complete: no actionable findings.'

/** Deterministic model response for the webhook-created Session.
 * @remarks 中文说明：类说明：ReviewAdapter 用于集中封装 处理 ReviewAdapter 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 apps/web 在对应插件或业务生命周期内创建和调用。 */
class ReviewAdapter extends LlmAdapter {
  /**
   * 常量说明：requests 用于处理 requests 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly requests: GenerateOptions[] = []

  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param options （GenerateOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<StreamChunk>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(options)，并按返回类型处理结果。
   */
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Reserve one currently free loopback port for the isolated WebServer.
 * @remarks 中文说明：功能说明：处理 freePort 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：Promise<number>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * freePort()，并按返回类型处理结果。 */
async function freePort(): Promise<number> {
  /**
   * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const server = createServer()
  await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => server.listen(0, '127.0.0.1', resolve))
  /**
   * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const port = (server.address() as AddressInfo).port
  await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ resolve => server.close(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }))
  return port
}

/** Sign one exact GitHub JSON body.
 * @remarks 中文说明：功能说明：处理 signature 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：body（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 signature(body)，并按返回类型处理结果。 */
function signature(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
}

/** Send one signed GitHub delivery to a selected origin.
 * @remarks 中文说明：功能说明：处理 send 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：origin（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：delivery（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：body（object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：Promise<Response>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 send(origin, delivery,
 * body, event)，并按返回类型处理结果。 */
async function send(origin: string, delivery: string, body: object, event = 'pull_request'): Promise<Response> {
  /**
   * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const text = JSON.stringify(body)
  return await fetch(`${origin}/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature(text),
      'x-github-event': event,
      'x-github-delivery': delivery,
    },
    body: text,
  })
}

describe.skipIf(MODE === 'record')('web e2e: GitHub ready-for-review', /*
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
   * 变量说明：webhookOrigin 用于处理 webhookOrigin 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
    let webhookOrigin: string
    /**
   * 变量说明：tripwire 用于处理 tripwire 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
    let tripwire: ReturnType<typeof watchConsole>
    /**
   * 变量说明：previousPort 用于处理 previousPort 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
    let previousPort: string | undefined
    /**
   * 变量说明：previousSecret 用于处理 previousSecret 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
    let previousSecret: string | undefined
    /**
   * 常量说明：adapter 用于处理 adapter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const adapter = new ReviewAdapter()

    beforeAll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        previousPort = process.env.DSH_GITHUB_WEBHOOK_PORT
        previousSecret = process.env.DSH_GITHUB_WEBHOOK_SECRET
        /**
     * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const port = await freePort()
        process.env.DSH_GITHUB_WEBHOOK_PORT = String(port)
        process.env.DSH_GITHUB_WEBHOOK_SECRET = SECRET
        webhookOrigin = `http://127.0.0.1:${String(port)}`
        scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
        scaffold.ctx.effect(
          /*
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */ () => scaffold.ctx.llm.registerAdapter([PROVIDER], adapter),
          'GitHub webhook review adapter',
        )
        await scaffold.ctx.agentDefaultModel.saveSelection({ provider: PROVIDER, model: MODEL })

        browser = await chromium.launch()
        page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
        await page.addInitScript(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { localStorage.setItem('dsh.locale', 'en') })
        tripwire = watchConsole(page)
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      }, 60_000)

    afterAll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        await browser?.close()
        await scaffold?.close()
        if (previousPort === undefined) Reflect.deleteProperty(process.env, 'DSH_GITHUB_WEBHOOK_PORT')
        else process.env.DSH_GITHUB_WEBHOOK_PORT = previousPort
        if (previousSecret === undefined) Reflect.deleteProperty(process.env, 'DSH_GITHUB_WEBHOOK_SECRET')
        else process.env.DSH_GITHUB_WEBHOOK_SECRET = previousSecret
      })

    it('isolates ingress and creates a browsable Workspace Session', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        onTestFailed(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => { await saveFailureShot(page, 'github-ready-review') })
        /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const before = scaffold.ctx.agents.list().length

        expect((await fetch(`${webhookOrigin}/api`)).status).toBe(404)
        expect((await send(scaffold.baseUrl, 'wrong-port', { zen: 'ping' }, 'ping')).status).not.toBe(202)
        expect(scaffold.ctx.agents.list()).toHaveLength(before)

        expect((await send(webhookOrigin, 'ping', { zen: 'keep it logically awesome' }, 'ping')).status).toBe(202)
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(scaffold.ctx.agents.list()).toHaveLength(before) })

        /**
     * 常量说明：payload 用于处理 payload 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const payload = {
          action: 'ready_for_review',
          number: 314,
          repository: { full_name: 'deepseek-harness/deepseek-harness' },
          pull_request: {
            title: 'Fix session replay',
            html_url: 'https://github.com/deepseek-harness/deepseek-harness/pull/314',
            draft: false,
            user: { login: 'octocat' },
            base: { ref: 'master', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
            head: { ref: 'fix-session-replay', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
          },
        }
        expect((await send(webhookOrigin, 'ready', payload)).status).toBe(202)
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(scaffold.ctx.agents.list()).toHaveLength(before + 1) })
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(adapter.requests).toHaveLength(1) })

        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = scaffold.ctx.agents.list().find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => candidate.session.header.cwd === scaffold.workspaceCwd)
        expect(agent).toBeDefined()
        /**
     * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(scaffold.workspaceCwd)
        expect(workspace?.sessionIds).toContain(agent?.id)
        /**
     * 常量说明：webhookMessage 用于处理 webhookMessage 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const webhookMessage = adapter.requests[0]?.messages.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ message => message.source.kind === 'webhook')
        expect(webhookMessage?.content).toHaveLength(1)
        /**
     * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const [content] = webhookMessage?.content ?? []
        expect(content?.type).toBe('text')
        if (content?.type !== 'text') throw new Error('webhook prompt was not text')
        expect(content.text).toContain('exact head SHA bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

        /**
     * 常量说明：workspaceRow 用于处理 workspaceRow 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const workspaceRow = page.locator('[role="treeitem"]').first()
        if (await workspaceRow.getAttribute('aria-expanded') !== 'true') await workspaceRow.click()
        await page.getByText(TITLE, { exact: true }).click()
        await page.getByText(REPLY, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
        /**
     * 常量说明：tree 用于处理 tree 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const tree = await captureStableAria(page, '[role="tree"][aria-label="Sessions"]', scaffold.workspaceCwd)
        /**
     * 常量说明：conversation 用于处理 conversation 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const conversation = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
        await compareOrRefreshGolden(EXPECTED, `${tree}\n\n---\n\n${conversation}`, MODE)
        /**
     * 常量说明：expanded 用于处理 expanded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const expanded = await captureExpandedTurnProcessAria(
          page,
          '[class*="centerCol"]',
          scaffold.workspaceCwd,
        )
        await compareOrRefreshGolden(EXPANDED_EXPECTED, `${tree}\n\n---\n\n${expanded}`, MODE)
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
      }, 60_000)
  })
