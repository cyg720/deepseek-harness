// @vitest-environment jsdom
/** 共享视图模型：状态、身份、耗时与折叠行摘要的逐分支断言。 */
import { expect, it } from 'vitest'
import {
  TOOL_TREE_MAX_DEPTH, displayPath, durationSeconds, errorOf, isOrphanResult, stateKey, summaryOf,
  toolName, toolState,
} from '../src/client/tool-view-model.ts'
import { resultNode, runningCall } from './tool-fixtures.client.ts'

it('状态判定与官方一致：中断优先于失败，未结算为运行中', () => {
  expect(toolState(runningCall())).toBe('running')
  expect(toolState(resultNode())).toBe('ok')
  expect(toolState(resultNode({ isError: true }))).toBe('error')
  expect(toolState(resultNode({ isError: true, error: { name: 'Interrupted', code: 'interrupted' } }))).toBe('stopped')
  expect(toolState(resultNode({ isError: true, error: { name: 'X', code: 'other' } }))).toBe('error')
})

it('状态文案键覆盖四种状态', () => {
  expect(stateKey('running')).toBe('state.running')
  expect(stateKey('error')).toBe('state.error')
  expect(stateKey('stopped')).toBe('state.stopped')
  expect(stateKey('ok')).toBe('state.ok')
})

it('工具名与孤儿判定只依赖调用头', () => {
  expect(toolName(runningCall({ name: 'read' }))).toBe('read')
  expect(toolName(resultNode({ call: null }))).toBe('')
  expect(isOrphanResult(resultNode({ call: null }))).toBe(true)
  expect(isOrphanResult(resultNode())).toBe(false)
  expect(isOrphanResult(runningCall())).toBe(false)
})

it('耗时只在官方同时给出配对时间时计算', () => {
  expect(durationSeconds(resultNode({ callTime: 1_000, time: 5_200 }))).toBe(4.2)
  expect(durationSeconds(resultNode({ callTime: null }))).toBeUndefined()
  expect(durationSeconds(runningCall())).toBeUndefined()
})

it('折叠行摘要按工具的优先参数名取第一个可读文本', () => {
  expect(summaryOf('bash', '{"command":"ls -la","description":"列目录"}')).toBe('列目录')
  expect(summaryOf('bash', '{"command":"ls -la"}')).toBeUndefined()
  expect(summaryOf('read', '{"file_path":"a.ts","offset":2}')).toBe('a.ts')
  expect(summaryOf('web_search', '{"queries":["a","b"]}')).toBe('a, b')
  expect(summaryOf('unknown_tool', '{"path":"p"}')).toBe('p')
  // 空描述不能遮住后续仍有意义的允许字段。
  expect(summaryOf('unknown_tool', '{"description":"","path":"p"}')).toBe('p')
  expect(summaryOf('unknown_tool', '{"other":1}')).toBeUndefined()
  expect(summaryOf('bash', 'not json')).toBeUndefined()
  expect(summaryOf('unknown_tool', '{"path":[]}')).toBeUndefined()
  expect(summaryOf('unknown_tool', '{"queries":["a",1]}')).toBeUndefined()
  expect(summaryOf('bash', '{"command":""}')).toBeUndefined()
})

it('错误摘要只来自结算结果', () => {
  expect(errorOf(resultNode({ isError: true, error: { name: 'Boom', code: 'E1' } }))).toEqual({ name: 'Boom', code: 'E1' })
  expect(errorOf(resultNode())).toBeUndefined()
  expect(errorOf(runningCall())).toBeUndefined()
})

it('显示路径按工作区根相对化，缺工作区根时保持原样', () => {
  expect(displayPath('/root/project/src/a.ts', '/root/project')).toBe('src/a.ts')
  expect(displayPath('/other/a.ts', '/root/project')).toBe('/other/a.ts')
  expect(displayPath('/other/a.ts', undefined)).toBe('/other/a.ts')
})

it('呈现层树深上限是显式常量', () => {
  expect(TOOL_TREE_MAX_DEPTH).toBeGreaterThan(1)
})

it('折叠摘要不自动展示原始命令或明显的凭据载荷', () => {
  for (const name of ['bash', 'pwsh', 'unknown_tool']) {
    const argsRaw = JSON.stringify({ command: "curl -H 'Authorization: Bearer synthetic-secret'", env: { TOKEN: 'synthetic-secret' } })
    expect(summaryOf(name, argsRaw)).toBeUndefined()
    expect(JSON.parse(argsRaw)).toMatchObject({ env: { TOKEN: 'synthetic-secret' } })
  }
  for (const description of [
    'Authorization: Bearer synthetic-secret', 'Cookie: session=synthetic-secret',
    'API_KEY=synthetic-secret run', '$env:TOKEN = synthetic-secret',
    'password: synthetic-secret', 'Bearer synthetic-secret',
    'https://user:synthetic-secret@example.invalid/path',
    'https://example.invalid/path?token=synthetic-secret',
    'https://example.invalid/#synthetic-secret',
  ]) {
    expect(summaryOf('bash', JSON.stringify({ description }))).toBeUndefined()
  }
  expect(summaryOf('web_fetch', JSON.stringify({ url: 'https://example.invalid/docs' }))).toBe('https://example.invalid/docs')
})
