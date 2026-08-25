/** Package-local scripted child boundary for deterministic tool-subagent tests. */
/*
 * 文件职责：验证 scripted-provider.ts 覆盖的子代理工具行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子代理工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'

/** 中文说明：常量 DEFAULT_CAPABILITIES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_CAPABILITIES: SubagentCapabilities = {
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
}

/** Options for one scripted provider fixture. */
/* 中文说明：interface Config 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
export interface Config {
  /** Registry name to register under. */
  name: string
  /** Final text returned by the scripted child. */
  reply?: string
  /** Terminal result reason. */
  stopReason?: SubagentStopReason
  /** Safe non-assistant detail for a non-completed result. */
  diagnostic?: string
  /** Start-time features advertised by the provider. */
  capabilities?: Partial<SubagentCapabilities>
  /** Whether tool descriptions say the child inherits completed turns. */
  inheritsParentContext?: boolean
  /** Structured value returned when the request asks for one. */
  structured?: unknown
  /** Observes each start; the child's result additionally waits for the returned promise. */
  onStart?: (request: SubagentStartRequest) => Promise<void> | void
}

/** Scripted provider whose result aborts if its signal or disposer wins first. */
/* 中文说明：class ScriptedSubagentProvider 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
class ScriptedSubagentProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities
  readonly inheritsParentContext: boolean

  constructor(
    readonly name: string,
    private readonly config: Config,
  ) {
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...config.capabilities }
    this.inheritsParentContext = config.inheritsParentContext ?? false
  }

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    if (request.signal.aborted) throw new Error('scripted subagent start aborted before publication')
    /** 中文说明：变量 reply 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reply = this.config.reply ?? 'scripted subagent reply'
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output: ContentBlock[] = [{ type: 'text', text: reply }]
    /** 中文说明：变量 wantsStructured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wantsStructured = request.outputSchema !== undefined && this.capabilities.outputSchema
    /** 中文说明：变量 stopReason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stopReason = this.config.stopReason ?? 'completed'
    /** 中文说明：变量 state 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const state = { cancelled: false }
    /** 中文说明：函数值 onAbort 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const onAbort = (): void => { state.cancelled = true }
    request.signal.addEventListener('abort', onAbort, { once: true })
    await Promise.resolve()
    if (state.cancelled) {
      request.signal.removeEventListener('abort', onAbort)
      throw new Error('scripted subagent start aborted before publication')
    }

    /** 中文说明：函数值 resultFor 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const resultFor = (): SubagentResult => {
      /** 中文说明：变量 terminal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const terminal = state.cancelled ? 'aborted' : stopReason
      return {
        output,
        ...wantsStructured ? { structured: this.config.structured ?? { reply } } : {},
        ...this.config.diagnostic !== undefined && terminal !== 'completed'
          ? { diagnostic: this.config.diagnostic }
          : {},
        stopReason: terminal,
      }
    }
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.resolve(this.config.onStart?.(request))
    /** 中文说明：函数值 result 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const result = gate.then(() => new Promise<SubagentResult>((resolve) => {
      setTimeout(() => { resolve(resultFor()) }, 0)
    })).finally(() => {
      request.signal.removeEventListener('abort', onAbort)
    })

    return {
      id: SessionId(`scripted-subagent:${this.name}:${request.parent.id}`),
      localAgent: undefined,
      result,
      dispose(): Promise<void> {
        state.cancelled = true
        request.signal.removeEventListener('abort', onAbort)
        return Promise.resolve()
      },
    }
  }
}

/**
 * Mount one scripted provider through an effect-scoped local plugin.
 * @param ctx - context carrying the real subagent registry.
 * @param config - scripted provider identity and outcome.
 * @returns the fixture plugin's disposable fiber.
 */
/* 中文说明：函数 mountScriptedProvider 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
export function mountScriptedProvider(ctx: Context, config: Config) {
  return ctx.plugin({
    name: 'scripted-subagent-provider',
    inject: ['subagents'],
    apply(pluginCtx: Context): void {
      pluginCtx.subagents.registerProvider(new ScriptedSubagentProvider(config.name, config))
    },
  })
}
