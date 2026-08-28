/**
 * 文件职责：验证工具注册与执行的 execution-signal-types.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证工具注册与执行在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { describe, expectTypeOf, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  ToolDispatchExecution,
  ToolExecution,
  ToolExecutionInput,
  ToolRunContext,
} from '@deepseek-ai/dsh-tools'

/** 中文说明：函数 inputAndExecutionContracts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function inputAndExecutionContracts(
  input: ToolExecutionInput,
  execution: ToolExecution,
  run: ToolRunContext,
): void {
  // @ts-expect-error -- every typed invocation must supply a caller-owned signal.
  const missingSignal: ToolExecutionInput = { callId: ToolCallId('missing'), name: 'probe', arguments: {} }
  void missingSignal

  // @ts-expect-error -- caller input is readonly after construction.
  input.signal = new AbortController().signal
  // @ts-expect-error -- required readonly properties cannot be deleted.
  delete input.signal
  // @ts-expect-error -- required signals cannot become undefined.
  input.signal = undefined

  // @ts-expect-error -- pipeline observers receive a readonly execution view.
  execution.signal = new AbortController().signal
  // @ts-expect-error -- pipeline observers cannot remove the required signal.
  delete execution.signal
  // @ts-expect-error -- tool bodies receive a readonly run context.
  run.signal = new AbortController().signal
  // @ts-expect-error -- tool bodies cannot remove the required signal.
  delete run.signal
  // @ts-expect-error -- tool bodies cannot replace the required signal with undefined.
  run.signal = undefined
}
void inputAndExecutionContracts

/** 中文说明：函数 observerContracts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function observerContracts(ctx: Context): void {
  ctx.on('tools/pre-execute', (exec, next) => {
    // @ts-expect-error -- pre-policy sees a readonly signal.
    exec.signal = new AbortController().signal
    // @ts-expect-error -- pre-policy cannot remove the required signal.
    delete exec.signal
    // @ts-expect-error -- pre-policy cannot replace the required signal with undefined.
    exec.signal = undefined
    return next()
  })
  ctx.on('tools/post-execute', (exec, _result, next) => {
    // @ts-expect-error -- post-policy sees a readonly signal.
    exec.signal = new AbortController().signal
    // @ts-expect-error -- post-policy sees a readonly signal.
    delete exec.signal
    // @ts-expect-error -- post-policy cannot replace the required signal with undefined.
    exec.signal = undefined
    return next()
  })
  ctx.on('tools/result', (exec) => {
    // @ts-expect-error -- result observers see a readonly signal.
    exec.signal = new AbortController().signal
    // @ts-expect-error -- result observers cannot remove the required signal.
    delete exec.signal
    // @ts-expect-error -- result observers see a readonly signal.
    exec.signal = undefined
  })
  ctx.on('tools/execute', (exec, next) => {
    exec.signal = new AbortController().signal
    // @ts-expect-error -- around-dispatch may replace but not remove the signal.
    delete exec.signal
    // @ts-expect-error -- around-dispatch cannot replace the required signal with undefined.
    exec.signal = undefined
    return next()
  })
}
void observerContracts

/** 中文说明：测试局部值 inferredTool，由紧邻初始化决定。 */
const inferredTool = defineTool({
  name: 'signal-inference',
  description: 'Pins contextual signal inference.',
  parameters: {},
  output: {
    schema: { type: 'null' },
    render: () => [],
  },
  async execute(_args, exec) {
    expectTypeOf(exec.signal).toEqualTypeOf<AbortSignal>()
    // @ts-expect-error -- defineTool contextually exposes a readonly signal.
    exec.signal = new AbortController().signal
    return null
  },
})
void inferredTool

describe('tool execution signal types', () => {
  it('requires an exact AbortSignal at every readonly tool view', () => {
    expectTypeOf<ToolExecutionInput['signal']>().toEqualTypeOf<AbortSignal>()
    expectTypeOf<ToolExecution['signal']>().toEqualTypeOf<AbortSignal>()
    expectTypeOf<ToolRunContext['signal']>().toEqualTypeOf<AbortSignal>()
    expectTypeOf<ToolDispatchExecution['signal']>().toEqualTypeOf<AbortSignal>()
    expectTypeOf<typeof inferredTool.execute>().toBeFunction()
  })
})
