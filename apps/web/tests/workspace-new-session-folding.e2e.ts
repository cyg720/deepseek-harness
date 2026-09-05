/** Blank New Session folding through the shipped Web composition.
 * @remarks 文件说明：文件职责：验证 apps/web 中 workspace new session folding e2e
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/**
 * 常量说明：EXPECTED_DIR 用于处理 EXPECTED_DIR 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const EXPECTED_DIR = fileURLToPath(new URL('./expected/workspace-new-session-folding', import.meta.url))
/**
 * 常量说明：SIDEBAR_EXPECTED 用于处理 SIDEBAR_EXPECTED 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SIDEBAR_EXPECTED = join(EXPECTED_DIR, 'sidebar.expected.md')
const SEED = fileURLToPath(new URL('../../../snapshots/web/message-feedback-protocol/session.v2.jsonl', import.meta.url))
const MODE = webSnapshotMode()
/**
 * 常量说明：EXISTING_SESSION_COUNT 用于处理 EXISTING_SESSION_COUNT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const EXISTING_SESSION_COUNT = 6

describe('web e2e: blank New Session folding quota', /*
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
        scaffold = await launchWebScaffold({})
        /**
     * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const fixture = await readFile(SEED, 'utf8')
        /**
     * 常量说明：sessionIds 用于处理 sessionIds 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const sessionIds = []
        for (let /* 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。 */ index = 1; index <= EXISTING_SESSION_COUNT; index += 1) {
          sessionIds.push(await seedSession(
            scaffold,
            fixture,
            `workspace-new-session-folding-${String(index).padStart(2, '0')}`,
          ))
        }
        /**
     * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
        /** 变量说明：sessionId 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。 */
        for (const sessionId of sessionIds) await workspace.attachSession(sessionId)

        browser = await chromium.launch()
        page = await newEnglishPage(browser)
        tripwire = watchConsole(page)
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

        /**
     * 常量说明：workspaceTitle 用于处理 workspaceTitle 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const workspaceTitle = basename(scaffold.workspaceCwd)
        /**
     * 常量说明：workspaceRow 用于处理 workspaceRow 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const workspaceRow = page.getByText(workspaceTitle, { exact: true }).first()
          .locator('xpath=ancestor::*[@role="treeitem"][1]')
        await workspaceRow.waitFor({ timeout: 15_000 })
        if (await workspaceRow.getAttribute('aria-expanded') !== 'true') await workspaceRow.click()
        await workspaceRow.hover()
        await page.getByRole('button', { name: `New session in ${workspaceTitle}` }).click()
        await page.getByRole('tree', { name: 'Sessions' })
          .getByText('New Session', { exact: true }).waitFor({ timeout: 15_000 })
      }, 120_000)

    afterAll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        await browser?.close()
        await scaffold?.close()
      })

    it('keeps five established sessions beside the provisional row', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        onTestFailed(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => saveFailureShot(page, 'web-e2e-workspace-new-session-folding'))
        /**
     * 常量说明：sidebar 用于处理 sidebar 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const sidebar = page.getByRole('tree', { name: 'Sessions' })
        await expect.poll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => sidebar.getByRole('treeitem').count(), { timeout: 15_000 }).toBe(7)
        expect(await sidebar.getByText('New Session', { exact: true }).count()).toBe(1)
        expect(await sidebar.getByText(basename(scaffold.workspaceCwd), { exact: true }).count()).toBe(6)
        /**
     * 常量说明：showMore 用于处理 showMore 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const showMore = sidebar.getByRole('button', { name: 'Show 1 more sessions' })
        await showMore.waitFor({ timeout: 15_000 })
        await compareOrRefreshGolden(
          SIDEBAR_EXPECTED,
          await captureStableAria(page, '[role="tree"][aria-label="Sessions"]', scaffold.workspaceCwd),
          MODE,
        )

        await showMore.click()
        await expect.poll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => sidebar.getByRole('treeitem').count(), { timeout: 10_000 }).toBe(8)
        expect(await sidebar.getByText(basename(scaffold.workspaceCwd), { exact: true }).count()).toBe(7)
        await sidebar.getByRole('button', { name: 'Show less' }).click()
        await expect.poll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => sidebar.getByRole('treeitem').count()).toBe(7)
        await assertFixtureInventory(EXPECTED_DIR, ['sidebar.expected.md'])
        expect(tripwire.pageErrors).toEqual([])
        expect(tripwire.warnings).toEqual([])
      })
  })
