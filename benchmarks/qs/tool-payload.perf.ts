/** 通过持久会话、生产投影及真实点击测量通用工具详情，不读取用户资料。 */
import { cpus, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { chromium, type Page, type CDPSession } from 'playwright'
import { expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage, createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { AssistantStreamAccumulator } from '@deepseek-ai/dsh-llm/assistant-stream'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, seedSession, watchConsole } from '../../apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../apps/web/tests/support.ts'

const SESSION_ID = 'qs-synthetic-tool-payload'
const SAMPLES = 6
// 手动对照只改变断行算法，不改变载荷、测量端点或产品默认配置。
const layout = process.env.QS_PAYLOAD_LAYOUT ?? 'production'
if (!['production', 'break-all', 'nowrap', 'textarea'].includes(layout)) throw new Error('Unsupported QS_PAYLOAD_LAYOUT')
// 仅改变合成载荷的换行密度，测量大小与采样数保持固定。
const contentLayout = process.env.QS_PAYLOAD_CONTENT ?? 'lines'
if (contentLayout !== 'lines' && contentLayout !== 'single-line') throw new Error('QS_PAYLOAD_CONTENT must be lines or single-line')

/** 固定 ASCII 行使字节数可核对，两个末尾标记用于排除静默截断。 */
function payloadFixture(bytes: number): { fixture: string; output: string; argumentsRaw: string } {
  const line = contentLayout === 'lines' ? 'synthetic payload line 0123456789\n' : 'synthetic_payload_line_0123456789_'
  const text = line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes)
  const output = text + '\nSYNTHETIC_RESULT_END'
  const argumentsRaw = JSON.stringify({ text, end: 'SYNTHETIC_ARGUMENT_END' })
  const session = Session.create(SessionId(SESSION_ID))
  const callId = ToolCallId('synthetic-payload-call')
  const toolBlock = { type: 'tool-call' as const, id: callId, name: 'synthetic_payload', arguments: argumentsRaw }
  const toolStream = new AssistantStreamAccumulator()
  toolStream.push({ time: 1700000000001, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } })
  toolStream.push({ time: 1700000000002, chunk: { type: 'tool-call-delta', index: 0, id: callId, name: toolBlock.name, argumentsDelta: argumentsRaw } })
  toolStream.push({ time: 1700000000003, chunk: { type: 'block-end', index: 0, block: toolBlock } })
  toolStream.push({ time: 1700000000004, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } })
  const finalBlock = { type: 'text' as const, text: 'SYNTHETIC_PAYLOAD_DONE' }
  const finalStream = new AssistantStreamAccumulator()
  finalStream.push({ time: 1700000000005, chunk: { type: 'block-start', index: 0, blockType: 'text' } })
  finalStream.push({ time: 1700000000006, chunk: { type: 'text-delta', index: 0, text: finalBlock.text } })
  finalStream.push({ time: 1700000000007, chunk: { type: 'block-end', index: 0, block: finalBlock } })
  finalStream.push({ time: 1700000000008, chunk: { type: 'finish', reason: { kind: 'stop' } } })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Inspect synthetic payload.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, stream: [...toolStream.snapshot()], message: createAssistantMessage({
    source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    content: [toolBlock],
  }) }, { surfaceOp: 'append' })
  const call = session.append('tool/call', { turn: 1, step: 1, callId, name: 'synthetic_payload', arguments: argumentsRaw })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: output }] }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', { turn: 1, step: 2, stream: [...finalStream.snapshot()], message: createAssistantMessage({
    source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, content: [finalBlock],
  }) }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const header = { type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 1700000000000, cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0 }
  return { fixture: [JSON.stringify(header), ...session.snapshotEvents().map(event => JSON.stringify(event)), ''].join('\n'), output, argumentsRaw }
}

/** 两次 rAF 仅代表浏览器有呈现机会，不声称测到显示器硬件显示。 */
async function painted(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

/** 计时包含浏览器动作等待与呈现机会；完整内容比较放在计时之后。 */
async function measure(page: Page, cdp: CDPSession, action: () => Promise<void>): Promise<{ wallMs: number; longTasks: number[]; browserMs: Record<string, number> }> {
  await page.evaluate(() => {
    const durations: number[] = []
    const observer = new PerformanceObserver(list => { durations.push(...list.getEntries().map(entry => entry.duration)) })
    observer.observe({ type: 'longtask' })
    Object.assign(globalThis, { __qsPayloadMeasurement: { durations, observer } })
  })
  const before = await cdp.send('Performance.getMetrics')
  const start = performance.now()
  await action()
  await painted(page)
  const wallMs = performance.now() - start
  const longTasks = await page.evaluate(() => {
    const state = globalThis as typeof globalThis & { __qsPayloadMeasurement?: { durations: number[]; observer: PerformanceObserver } }
    const measurement = state.__qsPayloadMeasurement
    if (!measurement) throw new Error('Missing payload measurement observer')
    measurement.durations.push(...measurement.observer.takeRecords().map(entry => entry.duration))
    measurement.observer.disconnect()
    delete state.__qsPayloadMeasurement
    return measurement.durations
  })
  const after = await cdp.send('Performance.getMetrics')
  const browserMs = Object.fromEntries(['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'].map(name => {
    const startValue = before.metrics.find(metric => metric.name === name)?.value
    const endValue = after.metrics.find(metric => metric.name === name)?.value
    if (startValue === undefined || endValue === undefined) throw new Error(`Missing browser metric ${name}`)
    return [name, (endValue - startValue) * 1000]
  }))
  return { wallMs, longTasks, browserMs }
}

/** 显式 GC 后保留实际页面与会话，区分已展开和退出后的可达内存。 */
async function retained(cdp: CDPSession): Promise<Record<string, number>> {
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.filter(metric => ['JSHeapUsedSize', 'Nodes', 'JSEventListeners', 'TaskDuration'].includes(metric.name)).map(metric => [metric.name, metric.value]))
}

for (const bytes of [32 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
  it(`measures complete tool expansion with ${bytes} bytes per field`, async () => {
    const { fixture, output, argumentsRaw } = payloadFixture(bytes)
    for (let sample = 0; sample < SAMPLES; sample++) {
      const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('../../apps/web/tests/qs/workbench.overlay.yml', import.meta.url)) })
      try {
        await seedSession(scaffold, fixture, SESSION_ID)
        const browser = await chromium.launch()
        try {
          const page = await newEnglishPage(browser)
          const errors = watchConsole(page)
          await page.setViewportSize({ width: 1280, height: 900 })
          const cdp = await page.context().newCDPSession(page)
          await cdp.send('Performance.enable')
          await page.goto(scaffold.authenticatedUrl)
          if (layout === 'break-all') await page.addStyleTag({ content: '[data-qs-tool-generic] pre { overflow-wrap: normal; word-break: break-all; }' })
          // 实验分支仅用于测量：长行改为横向滚动，不作为默认产品行为。
          if (layout === 'nowrap') await page.addStyleTag({ content: '[data-qs-tool-generic] pre { white-space: pre; overflow-wrap: normal; word-break: normal; overflow-x: auto; }' })
          if (layout === 'textarea') await page.evaluate(() => {
            // 诊断替身保留整段文本；不提交表单，不修改生产组件或持久载荷。
            const observer = new MutationObserver(() => {
              for (const source of document.querySelectorAll('[data-qs-tool-generic] pre')) {
                const target = document.createElement('textarea')
                for (const attribute of source.attributes) target.setAttribute(attribute.name, attribute.value)
                target.dataset.qsPayloadExperiment = 'true'
                target.readOnly = true
                target.setAttribute('aria-label', 'Synthetic complete tool text')
                target.textContent = source.textContent
                target.style.width = '100%'
                target.style.height = '230px'
                target.style.boxSizing = 'border-box'
                source.replaceWith(target)
              }
            })
            observer.observe(document.body, { childList: true, subtree: true })
          })
          await page.locator('#qs-login-user').fill('admin')
          await page.locator('#qs-login-password').fill('Demo@2026')
          await page.locator('#qs-login-password').press('Enter')
          await page.locator(`[data-qs-session="${SESSION_ID}"]`).click()
          await page.getByText('SYNTHETIC_PAYLOAD_DONE', { exact: true }).waitFor()
          const processRow = page.locator('[data-qs-process][data-turn="1"] > button')
          if (await processRow.getAttribute('aria-expanded') === 'false') await processRow.click()
          const tool = page.locator('[data-qs-tool]').first()
          await tool.waitFor()
          const header = tool.locator('[data-disclosure-row]').first()
          expect(await header.getAttribute('aria-expanded')).toBe('false')
          const collapsed = await retained(cdp)
          const openMs = await measure(page, cdp, async () => {
            await header.click()
            await tool.locator('[data-qs-tool-result]').waitFor()
          })
          expect(await tool.locator('[data-qs-tool-result]').textContent()).toBe(output)
          const args = tool.getByRole('button', { name: 'Arguments (raw text)', exact: true })
          const argumentsMs = await measure(page, cdp, async () => {
            await args.click()
            // CSS 定位只检查详情挂载；全文搜索会额外扫描巨型正文，不能混入用户展开成本。
            await tool.locator('pre, textarea[data-qs-payload-experiment]').nth(1).waitFor()
          })
          const pre = tool.locator('pre, textarea[data-qs-payload-experiment]').last()
          expect(JSON.parse(await pre.textContent() ?? '')).toEqual(JSON.parse(argumentsRaw))
          const expanded = await retained(cdp)
          const inputMs = await measure(page, cdp, async () => {
            await page.locator('#qs-composer-input').fill('Synthetic input while details are open')
          })
          expect(await page.locator('#qs-composer-input').inputValue()).toBe('Synthetic input while details are open')
          await header.click()
          expect(await tool.locator('pre, textarea[data-qs-payload-experiment]').count()).toBe(0)
          const reOpenMs = await measure(page, cdp, async () => {
            await header.click()
            await tool.locator('[data-qs-tool-result]').waitFor()
          })
          await page.getByRole('button', { name: 'Sign out', exact: true }).click()
          await page.locator('#qs-login-user').waitFor()
          await painted(page)
          const afterExit = await retained(cdp)
          expect(errors.pageErrors).toEqual([])
          console.log(JSON.stringify({ benchmark: 'qs-tool-payload/sample', layout, contentLayout, bytes, argumentsBytes: Buffer.byteLength(argumentsRaw), outputBytes: Buffer.byteLength(output), fixtureBytes: Buffer.byteLength(fixture), sample, warmup: sample === 0, openMs, argumentsMs, inputMs, reOpenMs, collapsed, expanded, afterExit }))
          if (sample === 0) console.log(JSON.stringify({ benchmark: 'qs-tool-payload/machine', node: process.version, browser: browser.version(), platform: platform(), release: release(), cpu: cpus()[0]?.model }))
        } finally { await browser.close() }
      } finally { await scaffold.close() }
    }
  })
}
