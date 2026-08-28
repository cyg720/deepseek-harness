/** The SDK app command provider and stdin shutdown binding.
 * @remarks 文件说明：文件职责：验证 bundle/sdk-app 中 startup spec 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { apply, type Config, SDK_APP_STARTUP_SERVICE } from '../src/index.ts'

/** Controllable stdin for one startup invocation.
 * @remarks 中文说明：类说明：TestStdin 用于集中封装 处理 TestStdin 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 bundle/sdk-app 在对应插件或业务生命周期内创建和调用。 */
class TestStdin extends EventEmitter {
  /**
   * 变量说明：readableEnded 用于处理 readableEnded 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  readableEnded = false

  /**
   * 功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。
   * @returns this；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resume()，并按返回类型处理结果。
   */
  resume(): this {
    return this
  }

  /**
   * 功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 end()，并按返回类型处理结果。
   */
  end(): void {
    this.readableEnded = true
    this.emit('end')
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  internals.stdin = process.stdin
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/** Run the provider with captured command output and exit requests.
 * @remarks 中文说明：功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：args（string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：config（Config）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：{ ctx: Context;
 * exits: number[]; out: () => string; stdin: TestStdin }；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 start(args, config)，并按返回类型处理结果。 */
function start(args: string[], config: Config = {}): { ctx: Context; exits: number[]; out: () => string; stdin: TestStdin } {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  /**
   * 常量说明：exits 用于处理 exits 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const exits: number[] = []
  /**
   * 常量说明：stdin 用于处理 stdin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stdin = new TestStdin()
  /**
   * 变量说明：out 用于处理 out 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let out = ''
  /**
   * 常量说明：capture 用于处理 capture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(chunk)，并按返回类型处理结果。
   */
  const capture = { write: (chunk: string) => { out += chunk; return true } }
  internals.stdin = stdin
  internals.stdout = capture
  internals.stderr = capture
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：listener（由 TypeScript
   * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(listener)，
   * 并按返回类型处理结果。
   */
  provideCmdline(ctx, {
    args,
    exit: code => void exits.push(code),
    ready: { onReady: (listener) => { listener(); /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
return () => {} } },
  })
  apply(ctx, config)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return { ctx, exits, out: () => out, stdin }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('SDK app startup', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('publishes readiness and requests bounded exit on client EOF', async () => {
    /**
     * 常量说明：ctx、exits、stdin 用于处理 ctx、exits、stdin 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { ctx, exits, stdin } = start([])
    expect(ctx.get(SDK_APP_STARTUP_SERVICE)).toEqual({ accepted: true })
    stdin.end()
    expect(exits).toEqual([0])
    await ctx.fiber.dispose()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('prints app help without publishing readiness or binding stdin', () => {
    /**
     * 常量说明：ctx、exits、out、stdin 用于处理 ctx、exits、out、stdin 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx, exits, out, stdin } = start(['--help'])
    expect(out()).toContain('dsh --profile sdk')
    expect(ctx.get(SDK_APP_STARTUP_SERVICE)).toBeUndefined()
    expect(exits).toEqual([0])
    stdin.end()
    expect(exits).toEqual([0])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('renders the selected SDK profile name in help', () => {
    /**
     * 常量说明：out 用于处理 out 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { out } = start(['--help'], { profile: 'sdk-minimal' })
    expect(out()).toContain('Usage: dsh --profile sdk-minimal')
    expect(out()).toContain('dsh --profile sdk-minimal')
  })
})
