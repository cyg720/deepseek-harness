// Keyless assembled-browser coverage for the private Agent Teams Web profiles
// over the real Host Typert Remote flow.
/**
 * 文件职责：验证 apps/web 中 agent team panel e2e 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/**
 * 常量说明：SNAPSHOT_DIR 用于处理 SNAPSHOT_DIR 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/agent-team-panel', import.meta.url))
/**
 * 常量说明：PANEL_EXPECTED 用于处理 PANEL_EXPECTED 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const PANEL_EXPECTED = join(SNAPSHOT_DIR, 'task.expected.md')
/**
 * 常量说明：OVERLAY 用于处理 OVERLAY 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const OVERLAY = fileURLToPath(new URL('./agent-team-panel.overlay.yml', import.meta.url))
/**
 * 常量说明：HOST_PATCH 用于处理 HOST_PATCH 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const HOST_PATCH = fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/cordis.patch.yml', import.meta.url))
/**
 * 常量说明：WEB_PATCH 用于处理 WEB_PATCH 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const WEB_PATCH = fileURLToPath(new URL('../../../packages/experimental/agent-team-web-profile/cordis.patch.yml', import.meta.url))
/**
 * 常量说明：INSTALL_ANCHORS 用于处理 INSTALL_ANCHORS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const INSTALL_ANCHORS = [
  fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/package.json', import.meta.url)),
  fileURLToPath(new URL('../../../packages/experimental/agent-team-web-profile/package.json', import.meta.url)),
]
/**
 * 常量说明：MODE 用于处理 MODE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODE = webSnapshotMode()

/**
 * 功能说明：处理 profileEntries 相关流程；使用场景由所在模块及调用位置决定。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns unknown[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 profileEntries(path)，并按返回类型处理结果。
 */
function profileEntries(path: string): unknown[] {
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`profile layer at ${path} must be a list`)
  return parsed
}

describe('Agent Teams panel overlay', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('matches the shipped Host and Web profile layers', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
        expect(profileEntries(OVERLAY)).toEqual([
          ...profileEntries(HOST_PATCH),
          ...profileEntries(WEB_PATCH),
        ])
      })
  })

describe('web e2e: Agent Teams panel', /*
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

    beforeAll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: INSTALL_ANCHORS })
        browser = await chromium.launch()
        page = await newEnglishPage(browser)
        tripwire = watchConsole(page)
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
        await connectFreshWorkspace(page, scaffold.workspaceCwd)
        /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const agent = scaffold.ctx.agents.list()[0]
        if (agent === undefined) throw new Error('connected Team workspace did not create an Agent')
        agent.session.append('turn/start', { turn: 1 })
        agent.session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'Open the Agent Team controls.' }],
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        agent.session.append('step/start', { turn: 1, step: 1 })
        agent.session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: createMessage({
            role: 'assistant',
            content: [{ type: 'text', text: 'Ready.' }],
            source: { kind: 'model', provider: 'fixture', model: 'fixture' },
          }),
        }, { surfaceOp: 'append' })
        agent.session.append('step/end', { turn: 1, step: 1 })
        agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await scaffold.ctx.sessions.flush(agent.session)
        await page.getByText('Ready.').waitFor({ timeout: 10_000 })
      }, 120_000)

    afterAll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        await browser?.close()
        await scaffold?.close()
      })

    it('loads the roster and creates one shared task through generated Remote', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        onTestFailed(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => saveFailureShot(page, 'web-e2e-agent-team-panel'))
        /**
     * 常量说明：action 用于处理 action 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const action = page.locator('[data-team-action]')
        await action.getByRole('button', { name: /Agent Team/iu }).click()
        await action.getByText('No shared tasks yet').waitFor()
        await action.getByText('lead').waitFor()

        await action.getByRole('button', { name: 'New task' }).click()
        await action.getByPlaceholder('Task subject').fill('Browser task')
        await action.getByPlaceholder('Task description').fill('Created through the assembled browser')
        await action.getByPlaceholder(/Write scopes/iu).fill('src/web')
        await action.getByRole('button', { name: 'Save' }).click()
        await action.getByText('Browser task').waitFor()

        /**
     * 常量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const snapshot = await captureStableAria(page, '[data-team-action]', scaffold.workspaceCwd)
        await compareOrRefreshGolden(PANEL_EXPECTED, snapshot, MODE)
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
      }, 60_000)

    it.skipIf(MODE === 'record')('keeps the fixture inventory closed', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        await assertFixtureInventory(SNAPSHOT_DIR, ['task.expected.md'])
      })
  })
