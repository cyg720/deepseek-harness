// @vitest-environment jsdom
/**
 * 文件职责：验证会话输入的 submission-policy.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ComposerSubmissionPolicy, DEFAULT_BUSY_ENTER_BEHAVIOR,
} from '../src/client/input/submission-policy.ts'
import type { ConversationSettings } from '../src/submission-settings.ts'

describe('ComposerSubmissionPolicy', () => {
  it('defaults to Queue and only applies the preference while running', () => {
    /** 中文说明：测试局部值 policy，由紧邻初始化决定。 */
    const policy = new ComposerSubmissionPolicy()
    expect(policy.busyEnter.getSnapshot()).toBe(DEFAULT_BUSY_ENTER_BEHAVIOR)
    expect(policy.resolve(false, 'enter', true)).toBe('queue')
    expect(policy.resolve(false, 'accelerated', true)).toBe('queue')
    expect(policy.resolve(true, 'enter', true)).toBe('queue')
    expect(policy.resolve(true, 'accelerated', true)).toBe('steer')
    expect(policy.resolve(true, 'enter', false)).toBe('queue')
    expect(policy.resolve(true, 'accelerated', false)).toBe('queue')

    /** 中文说明：测试局部值 changed，由紧邻初始化决定。 */
    const changed = vi.fn()
    policy.busyEnter.subscribe(changed)
    policy.setBusyEnter('steer')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(policy.resolve(true, 'enter', true)).toBe('steer')
    expect(policy.resolve(true, 'accelerated', true)).toBe('queue')
    expect(policy.resolve(false, 'enter', true)).toBe('queue')
    expect(policy.resolve(false, 'accelerated', true)).toBe('queue')
  })

  it('writes an explicit change through the scope after publishing it locally', () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<ConversationSettings>()
    /** 中文说明：测试局部值 observed，由紧邻初始化决定。 */
    const observed: string[] = []
    /** 中文说明：测试局部值 liveBehavior，由紧邻初始化决定。 */
    let liveBehavior = (): string => 'unconstructed'
    /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
    const scope: typeof host.scope = {
      ...host.scope,
      set: (field, value) => {
        observed.push(`${field}=${String(value)}:${liveBehavior()}`)
        return host.scope.set(field, value)
      },
    }
    /** 中文说明：测试局部值 policy，由紧邻初始化决定。 */
    const policy = new ComposerSubmissionPolicy(scope)
    liveBehavior = () => policy.busyEnter.getSnapshot()
    policy.setBusyEnter('steer')
    expect(observed).toEqual(['busyEnter=steer:steer'])
    expect(host.set).toHaveBeenCalledWith('busyEnter', 'steer')
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('adopts a Host preference without writing it back and leaves an identical write untouched', () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<ConversationSettings>()
    /** 中文说明：测试局部值 policy，由紧邻初始化决定。 */
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: { busyEnter: 'steer' }, revision: 1, writable: true })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    policy.setBusyEnter('steer')
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: { busyEnter: 'steer' }, revision: 2 })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('adopts a section already standing at construction', () => {
    /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
    const host = stubSettingsScope<ConversationSettings>()
    host.publish({ status: 'ready', value: { busyEnter: 'steer' }, revision: 1, writable: true })
    /** 中文说明：测试局部值 policy，由紧邻初始化决定。 */
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })
})
