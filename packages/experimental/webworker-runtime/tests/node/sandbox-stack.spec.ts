/** The unchanged sandbox-local → bash-sandbox → subprocess stack over the Worker Node layer.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 sandbox stack
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MemoryVfs } from '../../src/storage/memory.ts'
import { setActiveVfs } from '../../src/storage/active.ts'
import { processAlive, signalProcess } from '../../src/node/process-table.ts'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
vi.mock('node:child_process', async () => await import('../../src/node/builtin_modules/implemented/child_process.ts'))

/**
 * 常量说明：WORKSPACE 用于处理 WORKSPACE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const WORKSPACE = '/dsh/workspace'
/**
 * 常量说明：OUTSIDE 用于处理 OUTSIDE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const OUTSIDE = '/dsh/home'
/**
 * 变量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let vfs: MemoryVfs
/**
 * 常量说明：contexts 用于处理 contexts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const contexts: Context[] = []

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
beforeEach(() => {
  vfs = new MemoryVfs()
  setActiveVfs(vfs)
  vfs.mkdirSync(WORKSPACE, { recursive: true })
  vfs.mkdirSync(OUTSIDE, { recursive: true })
  vfs.mkdirSync('/dsh/tmp', { recursive: true })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：pid（number）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：signal（string | number）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：true；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(pid, signal)，
   * 并按返回类型处理结果。
   */
  vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number): true => {
    if (signal === 0) {
      if (processAlive(pid)) return true
      /**
       * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const error = new Error('kill ESRCH') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    }
    signalProcess(pid, (signal ?? 'SIGTERM') as NodeJS.Signals)
    return true
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ctx)，并按返回类型处理结果。
   */
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
  vi.restoreAllMocks()
})

/** Boot the production providers while only their platform primitives are replaced.
 * @remarks 中文说明：功能说明：处理 setup 相关流程；使用场景由所在模块及调用位置决定。；参数说明：mode（'read-only'
 * | 'workspace-write' | 'danger-full-access'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：Promise<SandboxBashExecutor>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 setup(mode)，并按返回类型处理结果。 */
async function setup(mode: 'read-only' | 'workspace-write' | 'danger-full-access'): Promise<SandboxBashExecutor> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalSandboxProvider)
  await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: WORKSPACE })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SandboxBashExecutor, { cwd: WORKSPACE })
  return ctx.shell as SandboxBashExecutor
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Worker Landlock through the production sandbox stack', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('allows workspace and temp writes while classifying an outside write as denied', async () => {
    /**
     * 常量说明：bash 用于处理 bash 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bash = await setup('workspace-write')
    /**
     * 常量说明：allowed 用于处理 allowed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const allowed = await bash.run(bash.resolve({
      command: `echo workspace > ${WORKSPACE}/allowed.txt; echo temp > /tmp/allowed.txt`,
    }))
    expect(allowed.sandbox).toEqual({ mode: 'workspace-write', denied: false, enforcement: 'full' })
    expect(vfs.readFileSync(`${WORKSPACE}/allowed.txt`, 'utf8')).toBe('workspace\n')
    expect(vfs.readFileSync('/dsh/tmp/allowed.txt', 'utf8')).toBe('temp\n')

    /**
     * 常量说明：denied 用于处理 denied 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const denied = await bash.run(bash.resolve({ command: `echo denied > ${OUTSIDE}/denied.txt` }))
    expect(denied.exitCode).toBe(1)
    expect(denied.sandbox).toEqual({ mode: 'workspace-write', denied: true, enforcement: 'full' })
    expect(vfs.existsSync(`${OUTSIDE}/denied.txt`)).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps read-only confined and danger-full-access unwrapped', async () => {
    /**
     * 常量说明：readOnly 用于读取 Only 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const readOnly = await setup('read-only')
    /**
     * 常量说明：strict 用于处理 strict 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const strict = await readOnly.run(readOnly.resolve({
      command: `echo discarded > /dev/null; echo denied > ${WORKSPACE}/strict.txt`,
    }))
    expect(strict.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
    expect(vfs.existsSync(`${WORKSPACE}/strict.txt`)).toBe(false)

    /**
     * 常量说明：unrestricted 用于处理 unrestricted 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const unrestricted = await setup('danger-full-access')
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await unrestricted.run(unrestricted.resolve({ command: `echo allowed > ${OUTSIDE}/full.txt` }))
    expect(result.sandbox).toEqual({ mode: 'danger-full-access', denied: false })
    expect(vfs.readFileSync(`${OUTSIDE}/full.txt`, 'utf8')).toBe('allowed\n')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('does not leak a concurrent command policy into another process', async () => {
    /**
     * 常量说明：bash 用于处理 bash 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bash = await setup('read-only')
    /**
     * 常量说明：strict 用于处理 strict 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const strict = bash.run(bash.resolve({
      command: `sleep 0.02; echo denied > ${WORKSPACE}/strict.txt`,
    }))
    /**
     * 常量说明：writable 用于处理 writable 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const writable = bash.run(bash.resolve({
      command: `echo allowed > ${WORKSPACE}/writable.txt`,
      sandboxPolicy: { mode: 'workspace-write', workspaceRoot: WORKSPACE },
    }))
    /**
     * 常量说明：strictResult、writableResult 用于处理 strictResult、writableResult 相关数据，
     * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const [strictResult, writableResult] = await Promise.all([strict, writable])
    expect(strictResult.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
    expect(writableResult.sandbox).toEqual({ mode: 'workspace-write', denied: false, enforcement: 'full' })
    expect(vfs.existsSync(`${WORKSPACE}/strict.txt`)).toBe(false)
    expect(vfs.readFileSync(`${WORKSPACE}/writable.txt`, 'utf8')).toBe('allowed\n')
  })
})
