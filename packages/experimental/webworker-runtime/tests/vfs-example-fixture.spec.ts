/**
 * 文件职责：验证 experimental/webworker-runtime 中 vfs example fixture spec
 * 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { scanLog } from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import {
  buildVfsExampleFiles,
  VFS_EXAMPLE_OLDEST_MESSAGE,
  VFS_EXAMPLE_ROOT,
  VFS_EXAMPLE_SESSION_IDS,
  VFS_EXAMPLE_TAIL_MESSAGE,
  VFS_EXAMPLE_TITLE,
} from './vfs-example-fixture.ts'

/**
 * 功能说明：处理 filesUnder 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 filesUnder(root)，并按返回类型处理结果。
 */
function filesUnder(root: string): string[] {
  /**
   * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const files: string[] = []
  /**
   * 常量说明：visit 用于处理 visit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
   * @param directory （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 visit(directory)，并按返回类型处理结果。
   */
  const visit = (directory: string): void => {
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      /**
       * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  visit(root)
  return files.sort()
}

/**
 * 功能说明：读取 Session 相关流程；使用场景由所在模块及调用位置决定。
 * @param id （string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。
 * @returns ReturnType<typeof scanLog>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readSession(id)，并按返回类型处理结果。
 */
function readSession(id: string): ReturnType<typeof scanLog> {
  return scanLog(readFileSync(
    join(VFS_EXAMPLE_ROOT, 'home/sessions/--dsh-workspace--', id, 'session.jsonl'),
  ))
}

/**
 * 功能说明：处理 textOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param event （SessionEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 textOf(event)，并按返回类型处理结果。
 */
function textOf(event: SessionEvent): string {
  if (event.type === 'user/message') {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    return event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  }
  if (event.type === 'assistant/message') {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
     */
    return event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  }
  return ''
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('WebWorker preview VFS example', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('matches its deterministic source byte for byte', () => {
    /**
     * 常量说明：expected 用于处理 expected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const expected = buildVfsExampleFiles()
    expect(filesUnder(VFS_EXAMPLE_ROOT)).toEqual([...expected.keys()].sort())
    /**
     * 变量说明：path、content 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [path, content] of expected) {
      expect(readFileSync(join(VFS_EXAMPLE_ROOT, path), 'utf8'), path).toBe(content)
    }
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('seeds the cold-list title cache against the main log identity', () => {
    /**
     * 常量说明：cache 用于处理 cache 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cache = JSON.parse(readFileSync(
      join(VFS_EXAMPLE_ROOT, 'home/storages/session_projcache.json'),
      'utf8',
    )) as {
      unit: { name: string; version: number }
      tables: { sessions: Record<string, { identity: { createdAt: number; cwd: string }; rows: { title: unknown } }> }
    }
    expect(cache.unit).toEqual({ name: 'session_projcache', version: 3 })
    expect(cache.tables.sessions[VFS_EXAMPLE_SESSION_IDS.main]).toMatchObject({
      identity: { createdAt: 1_787_472_000_000, cwd: '/dsh/workspace' },
      rows: { title: { ver: 1, val: VFS_EXAMPLE_TITLE } },
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('restores the main production log with paging and tool coverage', () => {
    /**
     * 常量说明：meta、events 用于处理 meta、events 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { meta, events } = readSession(VFS_EXAMPLE_SESSION_IDS.main)
    expect(meta).toMatchObject({
      id: VFS_EXAMPLE_SESSION_IDS.main,
      cwd: '/dsh/workspace',
      delegationDepth: 0,
      agentPreset: 'standard',
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_, index)，并按返回类型处理结果。
     */
    expect(events.map(event => event.seq)).toEqual(events.map((_, index) => index))
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => Session.fromRestore(SessionId(meta.id), events, meta)).not.toThrow()

    /**
     * 常量说明：messages 用于处理 messages 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const messages = events.filter(event =>
      (event.type === 'user/message' || event.type === 'assistant/message') && event.surfaceOp === 'append')
    expect(messages.length).toBeGreaterThan(50)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(messages.some(event => textOf(event).includes(VFS_EXAMPLE_OLDEST_MESSAGE))).toBe(true)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(messages.some(event => textOf(event).includes(VFS_EXAMPLE_TAIL_MESSAGE))).toBe(true)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(events.some(event => event.type === 'session/title'
      && (event.data as { title?: unknown }).title === VFS_EXAMPLE_TITLE)).toBe(true)

    /**
     * 常量说明：tools 用于处理 tools 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    const tools = events.flatMap(event => event.type === 'tool/call' ? [event.data.name] : [])
    expect(new Set(tools)).toEqual(new Set([
      'read', 'write', 'bash', 'glob', 'grep', 'web_search', 'todo_write', 'subagent', 'subagent_fork',
    ]))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(events.some(event => event.type === 'todo/write')).toBe(true)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
     * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
     */
    expect(events.some(event => event.type === 'tool/result' && event.data.message.content[0].isError === true)).toBe(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('restores one-shot and continuable child Sessions with durable descriptors', () => {
    /**
     * 常量说明：expected 用于处理 expected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const expected = [
      [VFS_EXAMPLE_SESSION_IDS.oneShot, 'one-shot'],
      [VFS_EXAMPLE_SESSION_IDS.continuable, 'continuable'],
    ] as const
    /**
     * 变量说明：id、mode 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [id, mode] of expected) {
      /**
       * 常量说明：meta、events 用于处理 meta、events 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const { meta, events } = readSession(id)
      expect(meta).toMatchObject({
        id,
        cwd: '/dsh/workspace',
        parentSession: VFS_EXAMPLE_SESSION_IDS.main,
        origin: 'subagent',
        delegationDepth: 1,
        agentPreset: 'standard',
      })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
       * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_, index)，并按返回类型处理结果。
       */
      expect(events.map(event => event.seq)).toEqual(events.map((_, index) => index))
      expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(foldSubagentDescriptor(events.slice(meta.seedLength ?? 0))).toMatchObject({ mode })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      expect(() => Session.fromRestore(SessionId(meta.id), events, meta)).not.toThrow()
    }
  })
})
