/**
 * 文件职责：验证 api/workspace-controller 中 directory picker host spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DirectoryPicker, DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { DirectoryPickerController } from '../src/directory-picker.ts'

/**
 * 常量说明：roots 用于处理 roots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const roots: Context[] = []

afterEach(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
    await Promise.all(roots.splice(0).map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（由 TypeScript
 * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ctx)，并按返回类型处理结果。
 */ ctx => ctx.fiber.dispose()))
  })

/** A backend serving exactly the capability one case is about.
 * @remarks 中文说明：类说明：StubPicker 用于集中封装 处理 StubPicker 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/workspace-controller
 * 在对应插件或业务生命周期内创建和调用。 */
class StubPicker extends DirectoryPicker {
  /**
   * 变量说明：capabilityStub 用于处理 capabilityStub 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  static capabilityStub: DirectoryPickerCapability = { kind: 'native', pick: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => null }

  /**
   * 功能说明：处理 capability 相关流程；使用场景由所在模块及调用位置决定。
   * @returns DirectoryPickerCapability；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 capability()，并按返回类型处理结果。
   */
  capability(): DirectoryPickerCapability {
    return StubPicker.capabilityStub
  }
}

/**
 * 常量说明：NATIVE_STUB 用于处理 NATIVE_STUB 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const NATIVE_STUB: DirectoryPickerCapability = { kind: 'native', pick: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => null }

/**
 * 常量说明：BROWSE_STUB 用于处理 BROWSE_STUB 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const BROWSE_STUB: DirectoryPickerCapability = {
  kind: 'browse',
  list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
 * 并按返回类型处理结果。
 */ async (path) => {
    if (path === '/denied') {
      throw new DirectoryPickerError('directory-unreadable', '/denied', 'cannot list /denied')
    }
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = path ?? '/home/user'
    return {
      path: target,
      home: '/home/user',
      crumbs: [{ name: '/', path: '/', hidden: false }],
      entries: [{ name: 'projects', path: `${target}/projects`, hidden: false }],
      truncated: false,
    }
  },
  createDirectory: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数：name（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, name)，并按返回类型处理结果。
 */ async (path, name) => {
    if (name === 'taken') {
      throw new DirectoryPickerError('directory-exists', `${path}/${name}`, 'already exists')
    }
    if (name === 'unwritable') throw new Error('disk detached')
    if (name === 'gone') throw 'the volume vanished'
    return `${path}/${name}`
  },
}

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @param capability （DirectoryPickerCapability）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness(capability)，并按返回类型处理结果。
 */
async function harness(capability: DirectoryPickerCapability = NATIVE_STUB) {
  StubPicker.capabilityStub = capability
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(StubPicker).await()
  return new DirectoryPickerController(ctx)
}

/** The failure payload a refused wire verb carries.
 * @remarks 中文说明：功能说明：处理 refused 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：call（Promise<unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<{
 * code: string; message: string; details: object }>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 refused(call)，并按返回类型处理结果。 */
async function refused(call: Promise<unknown>): Promise<{ code: string; message: string; details: object }> {
  try {
    await call
  } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
    if (!(error instanceof TypertRemoteFailure)) throw error
    return { ...error.failure }
  }
  throw new Error('the call was expected to be refused')
}

describe('directoryPicker pick Remote', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('answers the selected path or the operator\'s cancellation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const selected = await harness({ kind: 'native', pick: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => '/tmp/project' })
        expect(await selected.pick(new AbortController().signal)).toBe('/tmp/project')

        /**
     * 常量说明：cancelled 用于处理 cancelled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const cancelled = await harness(NATIVE_STUB)
        expect(await cancelled.pick(new AbortController().signal)).toBeNull()
      })

    it('reports an aborted chooser as cancelled and any other failure as internal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：picker 用于处理 picker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const picker = await harness({
          kind: 'native',
          pick: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
 */ signal => new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
 * 并按返回类型处理结果。
 */ (_resolve, reject) => {
              signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { reject(new Error('aborted')) }, { once: true })
            }),
        })
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = refused(picker.pick(abort.signal))
        abort.abort()
        expect((await pending).code).toBe('cancelled')

        /**
     * 常量说明：broken 用于处理 broken 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const broken = await harness({ kind: 'native', pick: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => { throw new Error('no chooser installed') } })
        /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failure = await refused(broken.pick(new AbortController().signal))
        expect(failure.code).toBe('internal')
        expect(failure.message).toContain('no chooser installed')
      })

    it('refuses the native verb under a browse composition', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：picker 用于处理 picker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const picker = await harness(BROWSE_STUB)
        /**
     * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const failure = await refused(picker.pick(new AbortController().signal))
        expect(failure.code).toBe('directory-picker-unavailable')
        expect(failure.message).toContain('needs the native capability')
        expect(failure.details).toEqual({ capability: 'browse' })
      })
  })

describe('directoryPicker browse Remotes', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('serves listings and creation, defaulting to the home directory', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：picker 用于处理 picker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const picker = await harness(BROWSE_STUB)
        /**
     * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const signal = new AbortController().signal
        expect(await picker.list(undefined, signal)).toMatchObject({ path: '/home/user', home: '/home/user' })
        expect(await picker.list('/home/user/projects', signal))
          .toMatchObject({ path: '/home/user/projects' })
        expect(await picker.createDirectory('/home/user', 'fresh')).toBe('/home/user/fresh')
      })

    it('maps the seam\'s typed failures and folds unknown throws to internal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：picker 用于处理 picker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const picker = await harness(BROWSE_STUB)
        expect(await refused(picker.list('/denied', new AbortController().signal)))
          .toMatchObject({ code: 'directory-unreadable', details: { path: '/denied' } })
        expect((await refused(picker.createDirectory('/home/user', 'taken'))).code).toBe('directory-exists')
        expect((await refused(picker.createDirectory('/home/user', 'unwritable'))).code).toBe('internal')

        /**
     * 常量说明：thrown 用于处理 thrown 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const thrown = await refused(picker.createDirectory('/home/user', 'gone'))
        expect(thrown).toMatchObject({ code: 'internal', message: 'the volume vanished' })
      })

    it('rejects invalid child names before capability dispatch', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：createDirectory 用于创建 Directory 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const createDirectory = vi.fn(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
 * 必须满足声明的类型及调用时序要求。；参数：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
 * 匿名回调(path, name)，并按返回类型处理结果。
 */ async (path: string, name: string) => `${path}/${name}`)
        /**
     * 常量说明：picker 用于处理 picker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const picker = await harness({
          kind: 'browse',
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, signal)，并按返回类型处理结果。
 */ (path, signal) => BROWSE_STUB.list(path, signal),
          createDirectory,
        })

        for (const /*
     * 变量说明：name 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ name of ['', ' ', '.', '..', 'a/b', 'a\\b']) {
          /**
       * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const failure = await refused(picker.createDirectory('/home/user', name))
          expect(failure).toMatchObject({
            code: 'bad-request',
            message: 'invalid payload for host.createDirectory',
          })
          expect(Array.isArray(Reflect.get(failure.details, 'issues'))).toBe(true)
        }
        expect(createDirectory).not.toHaveBeenCalled()
      })

    it('reports an aborted listing as cancelled', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：picker 用于处理 picker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const picker = await harness({
          kind: 'browse',
          list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_path（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；参数：signal（由 TypeScript
 * 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_path, signal)，并按返回类型处理结果。
 */ (_path, signal) => new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_resolve, reject)，
 * 并按返回类型处理结果。
 */ (_resolve, reject) => {
              signal?.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { reject(new Error('scan aborted')) }, { once: true })
            }),
          createDirectory: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => '/never',
        })
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = refused(picker.list(undefined, abort.signal))
        abort.abort()
        expect((await pending).code).toBe('cancelled')
      })

    it('refuses the browse verbs under a native composition', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：picker 用于处理 picker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const picker = await harness()
        expect(await refused(picker.list(undefined, new AbortController().signal)))
          .toMatchObject({ code: 'directory-picker-unavailable', details: { capability: 'native' } })
        expect(await refused(picker.createDirectory('/x', 'y')))
          .toMatchObject({ code: 'directory-picker-unavailable', details: { capability: 'native' } })
      })
  })
