/** Generic keyless ACP v1 automation-control conformance over the real dsh profile.
 * @remarks 文件说明：文件职责：验证 apps/cli 中 control surface e2e 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-session-snapshot'
import { describe, expect, it } from 'vitest'

/**
 * 常量说明：repoRoot 用于处理 repoRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
/**
 * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const agent: AgentUnderTest = {
  binScript: join(repoRoot, 'apps/cli/src/bin.ts'),
  libBinScript: join(repoRoot, 'apps/cli/lib/bin.js'),
  configPath: fileURLToPath(new URL('./fixtures/control-surface/cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: join(repoRoot, 'tsconfig.json'),
}
/**
 * 常量说明：mcpServer 用于处理 mcpServer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const mcpServer = fileURLToPath(new URL('../../../../../../packages/mcp/mcp-client/tests/fixture-server.ts', import.meta.url))

/** Find one named select value in grouped or ungrouped standard options.
 * @remarks 中文说明：功能说明：处理 selectValue 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（Awaited<ReturnType<LaunchedAcpTestAgent['client']['newSessi
 * …）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；参数说明：configId（string）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：string；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * selectValue(options, configId, name)，并按返回类型处理结果。 */
function selectValue(
  options: Awaited<ReturnType<LaunchedAcpTestAgent['client']['newSession']>>['configOptions'],
  configId: string,
  name: string,
): string {
  /**
   * 常量说明：option 用于处理 option 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const option = options?.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => candidate.id === configId)
  if (option?.type !== 'select') throw new Error(`missing select option: ${configId}`)
  /**
   * 常量说明：values 用于处理 values 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const values = option.options.flatMap(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => 'group' in candidate ? candidate.options : [candidate])
  /**
   * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const selected = values.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
 */ candidate => candidate.name === name)
  if (selected === undefined) throw new Error(`missing ${configId} value: ${name}`)
  return selected.value
}

describe('standard ACP v1 control surface', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('selects, mounts MCP, closes, restarts, resumes, and cancels through the SDK only', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cwd = await mkdtemp(join(tmpdir(), 'dsh-acp-control-'))
        /**
     * 常量说明：persistenceRoot 用于处理 persistenceRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const persistenceRoot = join(cwd, '.sessions')
        /**
     * 常量说明：env 用于处理 env 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const env = { DSH_CONFORMANCE_PERSISTENCE_ROOT: persistenceRoot, DSH_TELEMETRY_DISABLED: '1' }
        /**
     * 常量说明：mcpServers 用于处理 mcpServers 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const mcpServers = [{ name: 'fixture', command: process.execPath, args: [mcpServer], env: [] }]
        /**
     * 变量说明：first 用于处理 first 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let first: LaunchedAcpTestAgent | undefined
        /**
     * 变量说明：second 用于处理 second 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let second: LaunchedAcpTestAgent | undefined
        try {
          first = launchAcpTestAgent({ agent, cwd, env })
          await first.spawned
          /**
       * 常量说明：initialized 用于处理 initialized 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const initialized = await first.client.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: { _meta: { ignored: true } },
          })
          expect(initialized.agentCapabilities).toEqual({
            mcpCapabilities: { http: true },
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
            sessionCapabilities: { close: {}, list: {}, resume: {} },
          })
          expect('_meta' in initialized).toBe(false)
          /**
       * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const created = await first.client.newSession({ cwd, mcpServers })
          /**
       * 常量说明：beta 用于处理 beta 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const beta = selectValue(created.configOptions, 'model', 'Beta')
          /**
       * 常量说明：selectedModel 用于处理 selectedModel 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const selectedModel = await first.client.setSessionConfigOption({
            sessionId: created.sessionId,
            configId: 'model',
            value: beta,
          })
          /**
       * 常量说明：low 用于处理 low 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const low = selectValue(selectedModel.configOptions, 'reasoning_effort', 'Low')
          await first.client.setSessionConfigOption({
            sessionId: created.sessionId,
            configId: 'reasoning_effort',
            value: low,
          })

          await expect(first.client.prompt({
            sessionId: created.sessionId,
            prompt: [{ type: 'text', text: 'exercise the attached server' }],
          })).resolves.toEqual({ stopReason: 'end_turn' })
          expect(first.updates.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：update（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(update)，并按返回类型处理结果。
 */ update => update.sessionUpdate)).toEqual([
            'agent_thought_chunk',
            'usage_update',
            'tool_call',
            'tool_call_update',
            'agent_message_chunk',
            'usage_update',
          ])
          expect(first.updates).toContainEqual(expect.objectContaining({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'model=beta; tool=5' },
          }))
          /**
       * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const message = first.updates.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：update（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(update)，并按返回类型处理结果。
 */ update => update.sessionUpdate === 'agent_message_chunk')
          expect(message !== undefined && 'messageId' in message && typeof message.messageId === 'string').toBe(true)
          await first.client.closeSession({ sessionId: created.sessionId })
          await first.close()
          first = undefined

          second = launchAcpTestAgent({ agent, cwd, env })
          await second.spawned
          await second.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
          await expect(second.client.listSessions({ cwd })).resolves.toEqual({
            sessions: [{ sessionId: created.sessionId, cwd }],
          })
          await second.client.resumeSession({ sessionId: created.sessionId, cwd, mcpServers })
          /**
       * 常量说明：toolFinished 用于处理 toolFinished 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
          const toolFinished = second.waitForUpdate(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：update（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(update)，并按返回类型处理结果。
 */ update => (
              update.sessionUpdate === 'tool_call_update' && update.toolCallId === 'control-cancel-add'
            ))
          /**
       * 常量说明：prompt 用于处理 prompt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const prompt = second.client.prompt({
            sessionId: created.sessionId,
            prompt: [{ type: 'text', text: 'cancel after the tool finishes' }],
          })
          await toolFinished
          await second.client.cancel({ sessionId: created.sessionId })
          await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
          await second.client.closeSession({ sessionId: created.sessionId })
        } finally {
          await Promise.allSettled([first?.close(), second?.close()].filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：value is Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ (value): value is Promise<void> => value !== undefined))
          await rm(cwd, { recursive: true, force: true })
        }
      }, 30_000)
  })
