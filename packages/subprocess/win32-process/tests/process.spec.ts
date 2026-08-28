/**
 * 文件职责：验证 subprocess/win32-process 中 process spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import koffi from 'koffi'
import { describe, expect, it, vi } from 'vitest'
import {
  Win32Error,
  drainPipe,
  spawnInheritedJobProcess,
  spawnPipedProcess,
} from '../src/index.ts'
import { CREATE_SUSPENDED } from '../src/abi.ts'
import { PROCESS_INFORMATION } from '../src/ffi.ts'
import type { NativePtr, Win32ProcessBindings } from '../src/index.ts'

/**
 * 常量说明：PVOID 用于处理 PVOID 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PVOID = koffi.pointer('void')

/**
 * 功能说明：处理 inheritedApi 相关流程；使用场景由所在模块及调用位置决定。
 * @param overrides （Partial<Win32ProcessBindings>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns { api: Win32ProcessBindings events: string[]
 * createProcessAsUserW: Re…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 inheritedApi(overrides)，并按返回类型处理结果。
 */
function inheritedApi(overrides: Partial<Win32ProcessBindings> = {}): {
  api: Win32ProcessBindings
  events: string[]
  createProcessAsUserW: ReturnType<typeof vi.fn>
  assignProcessToJobObject: ReturnType<typeof vi.fn>
  resumeThread: ReturnType<typeof vi.fn>
} {
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const events: string[] = []
  /**
   * 常量说明：createProcessAsUserWImpl 用于创建 Process As User WImpl 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_token（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_app（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_line（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_pa（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_ta（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_inherit（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_flags（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_env（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_cwd（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_startup（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：info（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_token, _app, _line, _pa,
   * _ta, _inherit, _flags, _env, _cwd, _startup, info)，并按返回类型处理结果。
   */
  const createProcessAsUserWImpl: Win32ProcessBindings['createProcessAsUserW'] =
    overrides.createProcessAsUserW
    ?? ((_token, _app, _line, _pa, _ta, _inherit, _flags, _env, _cwd, _startup, info) => {
      events.push('create')
      koffi.encode(info, PROCESS_INFORMATION, {
        hProcess: 60n,
        hThread: 61n,
        dwProcessId: 1234,
        dwThreadId: 5678,
      })
      return 1
    })
  /**
   * 常量说明：createProcessAsUserW 用于创建 Process As User W 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const createProcessAsUserW = vi.fn(createProcessAsUserWImpl)
  /**
   * 常量说明：assignProcessToJobObject 用于处理 assignProcessToJobObject 相关数据，
   * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const assignProcessToJobObject = vi.fn(() => {
    events.push('assign')
    return 1
  })
  /**
   * 常量说明：resumeThread 用于处理 resumeThread 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const resumeThread = vi.fn(() => {
    events.push('resume')
    return 1
  })
  /**
   * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
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
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：selector（number）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(selector)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_handle（NativePtr）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：_mask（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数：flags（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_handle, _mask,
   * flags)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：handle（NativePtr）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(handle)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const api = {
    createJobObjectW: vi.fn(() => 50n),
    setInformationJobObject: vi.fn(() => 1),
    getStdHandle: vi.fn((selector: number) => BigInt(100 - selector)),
    setHandleInformation: vi.fn((_handle: NativePtr, _mask: number, flags: number) => {
      events.push(flags === 0 ? 'restore' : 'inherit')
      return 1
    }),
    assignProcessToJobObject,
    resumeThread,
    terminateProcess: vi.fn(() => 1),
    closeHandle: vi.fn((handle: NativePtr) => { events.push(`close:${handle}`); return 1 }),
    getLastError: vi.fn(() => 5),
    formatMessageW: vi.fn(() => 0),
    ...overrides,
    createProcessAsUserW,
  } as unknown as Win32ProcessBindings
  return {
    api,
    events,
    createProcessAsUserW,
    assignProcessToJobObject,
    resumeThread,
  }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('spawnInheritedJobProcess', () => {
  /**
   * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const token = 70n as NativePtr

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('creates suspended, assigns the Job, then resumes the restricted child', () => {
    /**
     * 常量说明：api、events、createProcessAsUserW、assignProcessToJobObject、resumeThre
     * ad 用于处理 api、events、createProcessAsUserW、assignProcessToJobObject、resumeT
     * hread 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const {
      api,
      events,
      createProcessAsUserW,
      assignProcessToJobObject,
      resumeThread,
    } = inheritedApi()
    /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const child = spawnInheritedJobProcess(api, {
      command: 'cmd.exe',
      args: ['/c', 'exit', '0'],
      cwd: 'C:\\work',
      token,
    })
    expect(child).toEqual({ pid: 1234, process: 60n, job: 50n })
    expect(events.indexOf('create')).toBeLessThan(events.indexOf('assign'))
    expect(events.indexOf('assign')).toBeLessThan(events.indexOf('resume'))
    expect(assignProcessToJobObject).toHaveBeenCalledWith(50n, 60n)
    expect(resumeThread).toHaveBeenCalledWith(61n)
    expect(createProcessAsUserW).toHaveBeenCalledWith(
      token,
      null,
      'cmd.exe /c exit 0',
      null,
      null,
      1,
      CREATE_SUSPENDED,
      null,
      'C:\\work',
      expect.anything(),
      expect.anything(),
    )
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('restores already-enabled stdio and closes the Job when inheritance setup fails', () => {
    /**
     * 变量说明：calls 用于处理 calls 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let calls = 0
    /**
     * 常量说明：closeHandle 用于关闭 Handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_handle（NativePtr）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(_handle)，并按返回类型处理结果。
     */
    const closeHandle = vi.fn((_handle: NativePtr) => 1)
    /**
     * 常量说明：setHandleInformation 用于设置 Handle Information 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_handle（NativePtr）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；参数：_mask（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
     * 参数：flags（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
     * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_handle, _mask,
     * flags)，并按返回类型处理结果。
     */
    const setHandleInformation = vi.fn((_handle: NativePtr, _mask: number, flags: number) => {
      if (flags === 0) return 1
      calls += 1
      return calls === 2 ? 0 : 1
    })
    /**
     * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { api } = inheritedApi({ closeHandle, setHandleInformation })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => spawnInheritedJobProcess(api, {
      command: 'cmd.exe',
      args: [],
      cwd: 'C:\\work',
      token,
    })).toThrow(Win32Error)
    expect(setHandleInformation).toHaveBeenCalledWith(expect.anything(), 1, 0)
    expect(closeHandle).toHaveBeenCalledWith(50n)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('captures a GetStdHandle error before Job cleanup changes last-error', () => {
    /**
     * 变量说明：lastError 用于处理 lastError 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let lastError = 123
    /**
     * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
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
    const { api } = inheritedApi({
      getStdHandle: vi.fn(() => 0n as NativePtr),
      getLastError: vi.fn(() => lastError),
      closeHandle: vi.fn(() => { lastError = 999; return 1 }),
    })
    /**
     * 变量说明：caught 用于处理 caught 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let caught: unknown
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      spawnInheritedJobProcess(api, { command: 'cmd.exe', args: [], cwd: 'C:\\work', token })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ api: 'GetStdHandle', win32Code: 123 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('captures a CreateProcess error before inheritance restoration changes last-error', () => {
    /**
     * 变量说明：lastError 用于处理 lastError 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let lastError = 87
    /**
     * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
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
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_handle（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_mask（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：flags（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_handle, _mask, flags)，
     * 并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const { api } = inheritedApi({
      createProcessAsUserW: vi.fn(() => 0),
      getLastError: vi.fn(() => lastError),
      setHandleInformation: vi.fn((_handle, _mask, flags) => {
        if (flags === 0) lastError = 999
        return 1
      }),
      closeHandle: vi.fn(() => { lastError = 998; return 1 }),
    })
    /**
     * 变量说明：caught 用于处理 caught 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let caught: unknown
    /**
     * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      spawnInheritedJobProcess(api, { command: 'cmd.exe', args: [], cwd: 'C:\\work', token })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ api: 'CreateProcessAsUserW', win32Code: 87 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('terminates the suspended process and closes the Job when CreateProcessAsUserW returns a null thread handle', () => {
    /**
     * 常量说明：closeHandle 用于关闭 Handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_handle（NativePtr）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(_handle)，并按返回类型处理结果。
     */
    const closeHandle = vi.fn((_handle: NativePtr) => 1)
    /**
     * 常量说明：terminateProcess 用于处理 terminateProcess 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const terminateProcess = vi.fn(() => 1)
    /**
     * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_token（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_app（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_line（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_pa（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_ta（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_inherit（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_flags（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_env（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_cwd（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_startup（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：info（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_token, _app, _line, _pa,
     * _ta, _inherit, _flags, _env, _cwd, _startup, info)，并按返回类型处理结果。
     */
    const { api } = inheritedApi({
      closeHandle,
      terminateProcess,
      createProcessAsUserW: vi.fn((_token, _app, _line, _pa, _ta, _inherit, _flags, _env, _cwd, _startup, info) => {
        koffi.encode(info, PROCESS_INFORMATION, {
          hProcess: 60n,
          hThread: 0n,
          dwProcessId: 1234,
          dwThreadId: 0,
        })
        return 1
      }),
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => spawnInheritedJobProcess(api, {
      command: 'cmd.exe',
      args: [],
      cwd: 'C:\\work',
      token,
    })).toThrow('null process/thread handles')
    expect(terminateProcess).toHaveBeenCalledWith(60n, 1)
    expect(closeHandle).toHaveBeenCalledWith(50n)
    expect(closeHandle).toHaveBeenCalledWith(60n)
  })

})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('wait and pipe cleanup', () => {
  /**
   * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const token = 70n as NativePtr

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('waits when a pipe is temporarily empty before observing EOF', async () => {
    /**
     * 常量说明：closeHandle 用于关闭 Handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const closeHandle = vi.fn(() => 1)
    /**
     * 变量说明：peeks 用于处理 peeks 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let peeks = 0
    /**
     * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_handle（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_buffer（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_size（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_read（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：available（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_handle, _buffer, _size,
     * _read, available)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const api = {
      peekNamedPipe: vi.fn((_handle, _buffer, _size, _read, available) => {
        peeks += 1
        if (peeks === 1) {
          koffi.encode(available, 'uint32', 0)
          return 1
        }
        return 0
      }),
      getLastError: vi.fn(() => 109),
      closeHandle,
    } as unknown as Win32ProcessBindings
    await expect(drainPipe(api, 80n as NativePtr)).resolves.toEqual(Buffer.alloc(0))
    expect(closeHandle).toHaveBeenCalledWith(80n)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('terminates a piped child when CreateProcess returns a null thread handle', () => {
    /**
     * 变量说明：nextPipe 用于处理 nextPipe 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let nextPipe = 10n
    /**
     * 常量说明：terminateProcess 用于处理 terminateProcess 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const terminateProcess = vi.fn(() => 1)
    /**
     * 常量说明：closeHandle 用于关闭 Handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const closeHandle = vi.fn(() => 1)
    /**
     * 常量说明：api 用于处理 api 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：readSlot（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：writeSlot（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(readSlot, writeSlot)，
     * 并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_token（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_app（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_line（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_pa（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_ta（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_inherit（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_flags（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_env（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_cwd（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：_startup（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：info（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_token, _app, _line, _pa,
     * _ta, _inherit, _flags, _env, _cwd, _startup, info)，并按返回类型处理结果。
     */
    const api = {
      createPipe: vi.fn((readSlot, writeSlot) => {
        koffi.encode(readSlot, PVOID, nextPipe++)
        koffi.encode(writeSlot, PVOID, nextPipe++)
        return 1
      }),
      setHandleInformation: vi.fn(() => 1),
      createProcessAsUserW: vi.fn((_token, _app, _line, _pa, _ta, _inherit, _flags, _env, _cwd, _startup, info) => {
        koffi.encode(info, PROCESS_INFORMATION, {
          hProcess: 60n,
          hThread: 0n,
          dwProcessId: 1234,
          dwThreadId: 0,
        })
        return 1
      }),
      terminateProcess,
      closeHandle,
    } as unknown as Win32ProcessBindings
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => spawnPipedProcess(api, {
      command: 'cmd.exe',
      args: [],
      cwd: 'C:\\work',
      token,
    })).toThrow('null process/thread handles')
    expect(terminateProcess).toHaveBeenCalledWith(60n, 1)
  })
})
