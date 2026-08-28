/**
 * The agent-preset Remote namespace: the path-free roster a client reads, the
 * composition view behind the read-only viewer, and the per-session switch —
 * which is the only one of the three that mutates an agent.
 * @remarks 文件说明：文件职责：验证 preset/agent-presets 中 remote spec 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { TypertRemoteFailure, type RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentPresets, { COMPOSITION_FILE, METADATA_FILE } from '@deepseek-ai/dsh-agent-presets'
import type { Config } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets/types'

/**
 * 常量说明：FIXTURES 用于处理 FIXTURES 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
/**
 * 常量说明：ROOTS 用于处理 ROOTS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const ROOTS = [
  { path: join(FIXTURES, 'system'), trust: 'system' as const },
  { path: join(FIXTURES, 'user'), trust: 'user' as const },
]
// A row naming a package, the way an authored preset's rows do. Health
// resolves every row it can prove will start, so a path reaching outside the
// temp preset directory these tests seed would report the composition broken.
/**
 * 常量说明：VALID 用于处理 VALID 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const VALID = '- id: prompt\n  name: \'@deepseek-ai/dsh-system-prompt\'\n'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => vi.restoreAllMocks())

/**
 * 功能说明：处理 remoteFailure 相关流程；使用场景由所在模块及调用位置决定。
 * @param operation （Promise<unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<RemoteFailure>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 remoteFailure(operation)，并按返回类型处理结果。
 */
async function remoteFailure(operation: Promise<unknown>): Promise<RemoteFailure> {
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    await operation
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TypertRemoteFailure)
    if (error instanceof TypertRemoteFailure) return error.failure
    throw error
  }
  throw new Error('expected the Remote operation to fail')
}

/**
 * 功能说明：处理 availableOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param failure （RemoteFailure）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns readonly string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 availableOf(failure)，并按返回类型处理结果。
 */
function availableOf(failure: RemoteFailure): readonly string[] {
  if (!('available' in failure.details)) throw new Error('expected available preset ids')
  /**
   * 常量说明：available 用于处理 available 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const available: unknown = failure.details.available
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：value is string；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  if (!Array.isArray(available)
    || !available.every((value: unknown): value is string => typeof value === 'string')) {
    throw new Error('expected available preset ids')
  }
  return available
}

/**
 * 功能说明：处理 reasonOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param failure （RemoteFailure）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 reasonOf(failure)，并按返回类型处理结果。
 */
function reasonOf(failure: RemoteFailure): string {
  if (!('reason' in failure.details)) throw new Error('expected a preset failure reason')
  /**
   * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const reason: unknown = failure.details.reason
  if (typeof reason !== 'string') throw new Error('expected a preset failure reason')
  return reason
}

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @param roster （Config）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<Context>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness(roster)，并按返回类型处理结果。
 */
async function harness(
  roster: Config = { default: 'standard', roots: ROOTS, includeShippedRoot: false, includeUserRoot: false },
): Promise<Context> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, roster)
  return ctx
}

/**
 * 功能说明：处理 agentOn 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @param presetId （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<Agent>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 agentOn(ctx, id, presetId)，并按返回类型处理结果。
 */
async function agentOn(ctx: Context, id: string, presetId?: string): Promise<Agent> {
  /**
   * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（Context）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
   */
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, presetId),
  })
  return handle.agent
}

/** The recorded preset a restart replays, which is what a switch must move.
 * @remarks 中文说明：常量说明：recordedPreset 用于处理 recordedPreset 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。；功能说明：处理 recordedPreset 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：agent（Agent）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * recordedPreset(agent)，并按返回类型处理结果。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */
const recordedPreset = (agent: Agent): unknown =>
  agent.session.events.findLast(event => event.type === 'agent-preset/selected')?.data

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('the roster a client reads', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('projects path-free rows, marking the default and carrying published metadata', async () => {
    /**
     * 常量说明：userRoot 用于处理 userRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-preset-remote-'))
    await mkdir(join(userRoot, 'documented'), { recursive: true })
    await writeFile(join(userRoot, 'documented', COMPOSITION_FILE), VALID)
    await writeFile(join(userRoot, 'documented', METADATA_FILE), 'name: 我的模式\ndescription: 只做检索。\n')
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness({
      default: 'minimal',
      roots: [{ path: join(FIXTURES, 'system'), trust: 'system' }, { path: userRoot, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })

    /**
     * 常量说明：roster 用于处理 roster 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const roster = await ctx.agentPresets.remoteExportList()

    expect(roster.authorable).toBe(true)
    expect(roster.presets).toEqual([
      { id: 'minimal', trust: 'system', isDefault: true },
      { id: 'standard', trust: 'system', isDefault: false },
      { id: 'documented', trust: 'user', isDefault: false, name: '我的模式', description: '只做检索。' },
    ])
    // No row carries the composition's location: a preset is addressed by id
    // everywhere off the Host.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：row（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(row)，并按返回类型处理结果。
     */
    expect(roster.presets.every(row => !('path' in row))).toBe(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps a broken preset on the roster with its reason', async () => {
    /**
     * 常量说明：userRoot 用于处理 userRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-preset-remote-'))
    await mkdir(join(userRoot, 'damaged'), { recursive: true })
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness({
      default: 'standard',
      roots: [{ path: join(FIXTURES, 'system'), trust: 'system' }, { path: userRoot, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })

    /**
     * 常量说明：roster 用于处理 roster 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const roster = await ctx.agentPresets.remoteExportList()

    // The directory still occupies the id, so a surface must be able to show
    // and delete it; offering it for selection is what the reason prevents.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：row（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(row)，并按返回类型处理结果。
     */
    expect(roster.presets.find(row => row.id === 'damaged')?.broken).toEqual(expect.any(String))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers an empty roster with nothing authorable', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness({ default: 'standard', roots: [], includeShippedRoot: false, includeUserRoot: false })

    /**
     * 常量说明：roster 用于处理 roster 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const roster = await ctx.agentPresets.remoteExportList()

    // Composing no presets is a valid deployment: every session then shares
    // the host composition, and nothing can be written either.
    expect(roster).toEqual({ presets: [], authorable: false })
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('reading one composition', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects an empty id before resolving it', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    /**
     * 常量说明：resolve 用于解析 resolve 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const resolve = vi.spyOn(ctx.agentPresets, 'resolve')

    await expect(ctx.agentPresets.readDocument(''))
      .rejects.toMatchObject({ failure: { code: 'bad-request' } })
    expect(resolve).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('answers the stored text with the row it belongs to', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()

    /**
     * 常量说明：document 用于处理 document 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const document = await ctx.agentPresets.readDocument('standard')

    // The shipped set is readable: it is the known-good composition a copy
    // starts from, and trust is what tells a surface to say so.
    expect(document).toEqual({
      agentPreset: 'standard',
      trust: 'system',
      content: await ctx.agentPresets.read('standard'),
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('carries the display metadata a preset published', async () => {
    /**
     * 常量说明：userRoot 用于处理 userRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-preset-remote-'))
    await mkdir(join(userRoot, 'documented'), { recursive: true })
    await writeFile(join(userRoot, 'documented', COMPOSITION_FILE), VALID)
    await writeFile(join(userRoot, 'documented', METADATA_FILE), 'name: 我的模式\ndescription: 只做检索。\n')
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness({
      default: 'documented',
      roots: [{ path: userRoot, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })

    /**
     * 常量说明：document 用于处理 document 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const document = await ctx.agentPresets.readDocument('documented')

    // The viewer titles the dialog from the published name, so both optional
    // fields have to survive the projection rather than only the id.
    expect(document).toEqual({
      agentPreset: 'documented',
      trust: 'user',
      content: VALID,
      name: '我的模式',
      description: '只做检索。',
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses an id no root supplies', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = await remoteFailure(ctx.agentPresets.readDocument('never-existed'))

    expect(failure).toMatchObject({
      code: 'agent-preset-not-found',
      details: {
        agentPreset: 'never-existed',
      },
    })
    expect(failure.message)
      .toMatch(/^agent-presets: preset "never-existed" not found \(available: .+\)$/)
    expect(availableOf(failure)).toEqual(expect.arrayContaining(['minimal', 'standard']))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the legacy internal diagnostic for an unrelated read failure', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    vi.spyOn(ctx.agentPresets, 'read').mockRejectedValueOnce(new Error('disk failed'))

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = await remoteFailure(ctx.agentPresets.readDocument('standard'))

    expect(failure).toEqual({
      code: 'internal',
      message: 'agent preset "standard": Error: disk failed',
      details: {},
    })
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('authoring over Remote', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects empty source, target, and delete ids before authoring', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    /**
     * 常量说明：copy 用于处理 copy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const copy = vi.spyOn(ctx.agentPresets, 'copy')
    /**
     * 常量说明：remove 用于移除 remove 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const remove = vi.spyOn(ctx.agentPresets, 'remove')

    /**
     * 变量说明：operation 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    for (const operation of [
      () => ctx.agentPresets.remoteExportCopy('', 'mine'),
      () => ctx.agentPresets.remoteExportCopy('standard', ''),
      () => ctx.agentPresets.remoteExportDelete(''),
    ]) {
      await expect(operation()).rejects.toMatchObject({ failure: { code: 'bad-request' } })
    }
    expect(copy).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('copies and deletes through the Remote adapters', async () => {
    /**
     * 常量说明：userRoot 用于处理 userRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-preset-remote-'))
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness({
      default: 'standard',
      roots: [{ path: join(FIXTURES, 'system'), trust: 'system' }, { path: userRoot, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })

    await ctx.agentPresets.remoteExportCopy('standard', 'mine', '我的模式')
    expect((await ctx.agentPresets.resolve('mine')).name).toBe('我的模式')

    await ctx.agentPresets.remoteExportDelete('mine')
    await expect(ctx.agentPresets.resolve('mine')).rejects.toThrow(/not found/)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves not-found details for an unknown copy source', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = await remoteFailure(ctx.agentPresets.remoteExportCopy('never-existed', 'mine'))

    expect(failure).toMatchObject({
      code: 'agent-preset-not-found',
      details: {
        agentPreset: 'never-existed',
      },
    })
    expect(failure.message)
      .toMatch(/^agent-presets: preset "never-existed" not found \(available: .+\)$/)
    expect(availableOf(failure)).toEqual(expect.arrayContaining(['minimal', 'standard']))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves invalid-id and occupied-id failures', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()

    /**
     * 常量说明：invalid 用于处理 invalid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const invalid = await remoteFailure(ctx.agentPresets.remoteExportCopy('standard', '../escape'))
    expect(invalid).toMatchObject({
      code: 'agent-preset-invalid',
      details: { agentPreset: '../escape' },
    })
    expect(reasonOf(invalid)).toContain('must match')

    /**
     * 常量说明：occupied 用于处理 occupied 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const occupied = await remoteFailure(ctx.agentPresets.remoteExportCopy('standard', 'minimal'))
    expect(occupied).toMatchObject({
      code: 'agent-preset-invalid',
      details: { agentPreset: 'minimal' },
    })
    expect(reasonOf(occupied)).toContain('already exists')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the requested id when no writable root exists', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness({
      default: 'standard',
      roots: [{ path: join(FIXTURES, 'system'), trust: 'system' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = await remoteFailure(ctx.agentPresets.remoteExportCopy('standard', 'mine'))

    expect(failure).toMatchObject({
      code: 'agent-preset-read-only',
      details: { agentPreset: 'mine' },
    })
    expect(reasonOf(failure)).toContain('no user-writable preset root')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves read-only and not-found delete failures', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()

    /**
     * 常量说明：readOnly 用于读取 Only 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const readOnly = await remoteFailure(ctx.agentPresets.remoteExportDelete('standard'))
    expect(readOnly).toMatchObject({
      code: 'agent-preset-read-only',
      details: { agentPreset: 'standard' },
    })
    expect(reasonOf(readOnly)).toContain('ships with the deployment')

    /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const missing = await remoteFailure(ctx.agentPresets.remoteExportDelete('never-existed'))
    expect(missing).toMatchObject({
      code: 'agent-preset-not-found',
      details: { agentPreset: 'never-existed' },
    })
    expect(availableOf(missing)).toEqual(expect.arrayContaining(['minimal', 'standard']))
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the legacy internal diagnostic for an unrelated authoring failure', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    vi.spyOn(ctx.agentPresets, 'copy').mockRejectedValueOnce(new Error('copy failed'))

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = await remoteFailure(ctx.agentPresets.remoteExportCopy('standard', 'mine'))

    expect(failure).toEqual({
      code: 'internal',
      message: 'agent preset "mine": Error: copy failed',
      details: {},
    })
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('switching one session\'s composition', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects an empty preset id before queuing a switch', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await agentOn(ctx, 'sel-empty', 'standard')
    /**
     * 常量说明：recompose 用于处理 recompose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const recompose = vi.spyOn(ctx.agentPresets, 'recompose')

    await expect(ctx.agentPresets.select(agent, ''))
      .rejects.toMatchObject({ failure: { code: 'bad-request' } })
    expect(recompose).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('recomposes a blank session and records what it now runs', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await agentOn(ctx, 'sel-1', 'standard')

    expect(await ctx.agentPresets.select(agent, 'minimal')).toBe('minimal')

    // The header is written once at creation, so the switch lives in the log:
    // that is what a restart replays and what every projection resolves from.
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('minimal')
    expect(recordedPreset(agent)).toEqual({ agentPreset: 'minimal' })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('serializes two concurrent switches on one session', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await agentOn(ctx, 'sel-race', 'standard')

    // Both pass the blank check; unserialized, the second re-link finds the
    // record the first already replaced and two compositions end up in one
    // agent layer. A client's busy flag is not enforcement.
    await Promise.all([
      ctx.agentPresets.select(agent, 'minimal'),
      ctx.agentPresets.select(agent, 'standard'),
    ])

    // One winner, and the log agrees with it: the last committed switch.
    expect(recordedPreset(agent)).toEqual({ agentPreset: 'standard' })
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('standard')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('refuses once the conversation has started', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await agentOn(ctx, 'sel-locked', 'standard')
    // One turn is enough: the history from here on was produced under
    // `standard`'s tools, and a swap would strand those tool calls.
    agent.session.append('turn/start', { turn: 0 })

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = await remoteFailure(ctx.agentPresets.select(agent, 'minimal'))

    expect(failure).toEqual({
      code: 'agent-preset-locked',
      message: 'session "sel-locked" has already started; its agent preset is fixed',
      details: { sessionId: SessionId('sel-locked'), agentPreset: 'minimal' },
    })
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('standard')
    expect(recordedPreset(agent)).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('leaves the session on its composition when the named preset is unknown', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await agentOn(ctx, 'sel-unknown', 'standard')

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = await remoteFailure(ctx.agentPresets.select(agent, 'nope'))

    expect(failure).toMatchObject({
      code: 'agent-preset-not-found',
      details: { agentPreset: 'nope' },
    })
    expect(availableOf(failure)).toEqual(expect.arrayContaining(['minimal', 'standard']))
    // Resolution happens before any re-link, and nothing is recorded until the
    // swap commits.
    expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe('standard')
    expect(recordedPreset(agent)).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('serves a later switch after one was refused', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await agentOn(ctx, 'sel-after-failure', 'standard')

    await expect(ctx.agentPresets.select(agent, 'nope')).rejects.toThrow(/not found/)

    // The queue holds a failure-swallowing guard, so a refused switch does not
    // reject the next caller's chain.
    expect(await ctx.agentPresets.select(agent, 'minimal')).toBe('minimal')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports an unusable composition with its discovery reason', async () => {
    /**
     * 常量说明：userRoot 用于处理 userRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-preset-remote-'))
    await mkdir(join(userRoot, 'damaged'), { recursive: true })
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness({
      default: 'standard',
      roots: [{ path: join(FIXTURES, 'system'), trust: 'system' }, { path: userRoot, trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await agentOn(ctx, 'sel-broken', 'standard')

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = await remoteFailure(ctx.agentPresets.select(agent, 'damaged'))

    expect(failure).toMatchObject({
      code: 'agent-preset-invalid',
      details: { agentPreset: 'damaged' },
    })
    expect(reasonOf(failure)).not.toBe('')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the legacy internal diagnostic for an unrelated switch failure', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await harness()
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await agentOn(ctx, 'sel-internal', 'standard')
    vi.spyOn(ctx.agentPresets, 'recompose').mockRejectedValueOnce(new Error('mount failed'))

    /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const failure = await remoteFailure(ctx.agentPresets.select(agent, 'minimal'))

    expect(failure).toEqual({
      code: 'internal',
      message: 'failed to select agent preset "minimal": Error: mount failed',
      details: {},
    })
  })
})
