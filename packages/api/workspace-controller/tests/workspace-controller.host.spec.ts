/**
 * 文件职责：验证 api/workspace-controller 中 workspace controller host spec
 * 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import WorkspaceController from '../src/index.ts'
import { WorkspaceFeed } from '../src/feed.ts'
import type { WorkspaceFollowFrame } from '../src/types.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

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

interface Deferred<T> {
  readonly promise: Promise<T>
  /**
   * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
   * @param value （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolve(value)，并按返回类型处理结果。
   */
  resolve(value: T): void
}

/**
 * 功能说明：处理 deferred 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Deferred<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 deferred()，并按返回类型处理结果。
 */
function deferred<T>(): Deferred<T> {
  /**
   * 变量说明：resolve 用于解析 resolve 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let resolve!: (value: T) => void
  /**
   * 常量说明：promise 用于处理 promise 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const promise = new Promise<T>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：settle（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(settle)，并按返回类型处理结果。
 */ (settle) => { resolve = settle })
  return { promise, resolve }
}

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness()，并按返回类型处理结果。
 */
async function harness() {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-controller-')))
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  /**
   * 常量说明：storageDomain 用于处理 storageDomain 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  /**
   * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 dispose()，并按返回类型处理结果。
   */
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => dispose },
    contexts: { configureHost: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => dispose },
  } as never)
  /**
   * 常量说明：controller 用于处理 controller 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const controller = new WorkspaceController(ctx)
  return { controller, ctx, root, storageDomain }
}

/**
 * 功能说明：处理 stageDir 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 stageDir(root, name)，并按返回类型处理结果。
 */
function stageDir(root: string, name: string): string {
  /**
   * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

/**
 * 功能说明：处理 nextFrame 相关流程；使用场景由所在模块及调用位置决定。
 * @param iterator （AsyncIterator<WorkspaceFollowFrame>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Promise<WorkspaceFollowFrame>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 nextFrame(iterator)，并按返回类型处理结果。
 */
async function nextFrame(
  iterator: AsyncIterator<WorkspaceFollowFrame>,
): Promise<WorkspaceFollowFrame> {
  /**
   * 常量说明：next 用于处理 next 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const next = await iterator.next()
  if (next.done === true) throw new Error('Workspace stream ended before the expected frame')
  return next.value
}

describe('WorkspaceController commands', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('serializes concurrent path adoption and preserves an existing title', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：controller、root 用于处理 controller、root 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { controller, root } = await harness()
        /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const path = stageDir(root, 'alpha')
        /**
     * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const results = await Promise.all([
          controller.create({ path }),
          controller.create({ path }),
        ])
        /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const created = results.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：result（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(result)，并按返回类型处理结果。
 */ result => result.created)
        /**
     * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const resolved = results.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：result（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(result)，并按返回类型处理结果。
 */ result => !result.created)
        expect(created).toMatchObject({ workspace: { path, title: 'alpha' } })
        expect(resolved?.workspace.workspaceId).toBe(created?.workspace.workspaceId)

        /**
     * 常量说明：workspaceId 用于处理 workspaceId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const workspaceId = created?.workspace.workspaceId
        if (workspaceId === undefined) throw new Error('fixture did not create a Workspace')
        await controller.rename({ workspaceId, title: 'renamed' })
        await expect(controller.create({ path })).resolves.toMatchObject({
          created: false,
          workspace: { workspaceId, title: 'renamed' },
        })
      })

    it('maps invalid paths, blank names, conflicts, and unknown ids to stable failures', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：controller、root 用于处理 controller、root 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const { controller, root } = await harness()
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = await controller.create({ path: stageDir(root, 'first') })
        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = await controller.create({ path: stageDir(root, 'second') })

        await expect(controller.create({ path: join(root, 'missing') })).rejects.toMatchObject({
          failure: { code: 'workspace-invalid-path', details: { path: join(root, 'missing') } },
        })
        expect(existsSync(join(root, 'missing'))).toBe(false)
        await expect(controller.rename({ workspaceId: first.workspace.workspaceId, title: '  ' }))
          .rejects.toMatchObject({ failure: { code: 'bad-request' } })
        await controller.rename({ workspaceId: first.workspace.workspaceId, title: 'occupied' })
        await expect(controller.rename({ workspaceId: second.workspace.workspaceId, title: ' occupied ' }))
          .rejects.toMatchObject({ failure: { code: 'workspace-name-conflict' } })
        await expect(controller.delete({ workspaceId: 'missing' as WorkspaceId }))
          .rejects.toMatchObject({ failure: { code: 'workspace-not-found' } })
      })

    it('preserves Remote failures and propagates unexpected registry failures', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：controller、ctx、root 用于处理 controller、ctx、root 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { controller, ctx, root } = await harness()
        /**
     * 常量说明：remoteFailure 用于处理 remoteFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const remoteFailure = new TypertRemoteFailure({
          code: 'fixture-failure',
          message: 'already mapped',
          details: {},
        })
        /**
     * 常量说明：resolveByPath 用于解析 By Path 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const resolveByPath = vi.spyOn(ctx.workspaceRegistry, 'resolveByPath')
          .mockRejectedValueOnce(remoteFailure)
          .mockRejectedValueOnce('plain failure')
        await expect(controller.create({ path: stageDir(root, 'remote-failure') }))
          .rejects.toBe(remoteFailure)
        /**
     * 常量说明：plainFailure 用于处理 plainFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const plainFailure = controller.create({ path: stageDir(root, 'plain-failure') })
        await expect(plainFailure).rejects.toMatchObject({
          failure: { code: 'workspace-invalid-path' },
        })
        await expect(plainFailure).rejects.toThrow('plain failure')
        resolveByPath.mockRestore()

        /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const created = await controller.create({ path: stageDir(root, 'created') })
        /**
     * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const workspace = ctx.workspaceRegistry.get(created.workspace.workspaceId)
        if (workspace === undefined) throw new Error('fixture Workspace disappeared')

        /**
     * 常量说明：orderFailure 用于处理 orderFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const orderFailure = new Error('order storage failed')
        vi.spyOn(ctx.workspaceRegistry, 'insertBefore').mockRejectedValueOnce(orderFailure)
        await expect(controller.insertBefore({ workspaceId: created.workspace.workspaceId }))
          .rejects.toBe(orderFailure)

        /**
     * 常量说明：moveFailure 用于处理 moveFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const moveFailure = new Error('membership storage failed')
        vi.spyOn(workspace, 'insertSessionBefore').mockRejectedValueOnce(moveFailure)
        await expect(controller.insertSessionBefore({
          workspaceId: created.workspace.workspaceId,
          sessionId: SessionId('session'),
        })).rejects.toBe(moveFailure)

        /**
     * 常量说明：archiveFailure 用于处理 archiveFailure 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const archiveFailure = new Error('archive storage failed')
        vi.spyOn(ctx.workspaceRegistry, 'archiveSession').mockRejectedValueOnce(archiveFailure)
        await expect(controller.archiveSession({ sessionId: SessionId('session') }))
          .rejects.toBe(archiveFailure)
      })

    it('resolves queued Workspace identities when their operation starts', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：controller、ctx、root 用于处理 controller、ctx、root 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { controller, ctx, root } = await harness()
        /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const target = await controller.create({ path: stageDir(root, 'target') })
        /**
     * 常量说明：blockerPath 用于处理 blockerPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const blockerPath = stageDir(root, 'blocker')
        /**
     * 常量说明：gate 用于处理 gate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const gate = deferred<undefined>()
        /**
     * 常量说明：originalResolveByPath 用于处理 originalResolveByPath 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const originalResolveByPath = ctx.workspaceRegistry.resolveByPath.bind(ctx.workspaceRegistry)
        /**
     * 常量说明：resolveByPath 用于解析 By Path 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const resolveByPath = vi.spyOn(ctx.workspaceRegistry, 'resolveByPath')
        resolveByPath.mockImplementationOnce(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（由 TypeScript
 * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path)，
 * 并按返回类型处理结果。
 */ async (path) => {
            await gate.promise
            return originalResolveByPath(path)
          })

        /**
     * 常量说明：blocker 用于处理 blocker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const blocker = controller.create({ path: blockerPath })
        /**
     * 常量说明：deletion 用于处理 deletion 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const deletion = controller.delete({ workspaceId: target.workspace.workspaceId })
        /**
     * 常量说明：staleRename 用于处理 staleRename 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const staleRename = controller.rename({
          workspaceId: target.workspace.workspaceId,
          title: 'must-not-land',
        })
        gate.resolve(undefined)
        await blocker
        await expect(deletion).resolves.toEqual({ deleted: true })
        await expect(staleRename).rejects.toMatchObject({ failure: { code: 'workspace-not-found' } })
      })

    it('reorders Workspaces and Sessions and archives only known Sessions', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：controller、ctx、root 用于处理 controller、ctx、root 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { controller, ctx, root } = await harness()
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = await controller.create({ path: stageDir(root, 'first') })
        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = await controller.create({ path: stageDir(root, 'second') })
        await expect(controller.insertBefore({
          workspaceId: first.workspace.workspaceId,
          beforeWorkspaceId: second.workspace.workspaceId,
        })).resolves.toEqual({
          workspaceIds: [first.workspace.workspaceId, second.workspace.workspaceId],
        })
        await expect(controller.insertBefore({ workspaceId: 'missing' as WorkspaceId }))
          .rejects.toMatchObject({ failure: { code: 'workspace-not-found' } })

        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('session-one'), {
          meta: { cwd: first.workspace.path },
        })
        /**
     * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const workspace = ctx.workspaceRegistry.get(first.workspace.workspaceId)
        if (workspace === undefined) throw new Error('fixture Workspace disappeared')
        await workspace.attachSession(session.id)
        await expect(controller.insertSessionBefore({
          workspaceId: first.workspace.workspaceId,
          sessionId: session.id,
        })).resolves.toMatchObject({ workspace: { sessionIds: [session.id] } })
        await expect(controller.insertSessionBefore({
          workspaceId: first.workspace.workspaceId,
          sessionId: SessionId('missing-session'),
        })).rejects.toMatchObject({ failure: { code: 'workspace-move-invalid' } })
        await expect(controller.insertSessionBefore({
          workspaceId: first.workspace.workspaceId,
          sessionId: session.id,
          beforeSessionId: SessionId('missing-anchor'),
        })).rejects.toMatchObject({
          failure: {
            code: 'workspace-move-invalid',
            details: { beforeSessionId: 'missing-anchor' },
          },
        })
        await expect(controller.insertSessionBefore({
          workspaceId: 'missing' as WorkspaceId,
          sessionId: session.id,
        })).rejects.toMatchObject({ failure: { code: 'workspace-not-found' } })

        await expect(controller.archiveSession({ sessionId: session.id }))
          .resolves.toEqual({ archivedSessionIds: [session.id] })
        await expect(controller.archiveSession({ sessionId: SessionId('unknown') }))
          .rejects.toMatchObject({ failure: { code: 'session-not-found' } })
      })
  })

describe('WorkspaceController follow', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('seeds a new feed from existing rows and rejects an inconsistent registry commit', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：ctx、root 用于处理 ctx、root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { ctx, root } = await harness()
        /**
     * 常量说明：existing 用于处理 existing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const existing = await ctx.workspaceRegistry.create(stageDir(root, 'existing'))
        /**
     * 常量说明：feed 用于处理 feed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const feed = new WorkspaceFeed(ctx)
        expect(feed.baseline()).toMatchObject({
          items: [{ workspaceId: existing.id }],
        })

        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
            ctx.emit('domain/changed', {
              domain: 'workspace',
              table: '',
              key: '',
              operation: 'put',
              value: {
                initialized: true,
                workspaceIds: ['missing'],
                archivedSessionIds: [],
              },
            })
          }).toThrow('references missing Workspace "missing"')
      })

    it('starts with a complete baseline and emits committed increments in domain order', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：controller、ctx、root 用于处理 controller、ctx、root 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { controller, ctx, root } = await harness()
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = controller.follow(abort.signal)[Symbol.asyncIterator]()
        await expect(nextFrame(iterator)).resolves.toEqual({
          type: 'baseline',
          value: { items: [], archivedSessionIds: [] },
        })

        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = await controller.create({ path: stageDir(root, 'first') })
        await expect(nextFrame(iterator)).resolves.toMatchObject({
          type: 'upsert', workspace: { workspaceId: first.workspace.workspaceId },
        })
        await expect(nextFrame(iterator)).resolves.toEqual({
          type: 'order', workspaceIds: [first.workspace.workspaceId],
        })
        await controller.rename({ workspaceId: first.workspace.workspaceId, title: 'renamed' })
        await expect(nextFrame(iterator)).resolves.toMatchObject({
          type: 'upsert', workspace: { title: 'renamed' },
        })

        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = await controller.create({ path: stageDir(root, 'second') })
        await expect(nextFrame(iterator)).resolves.toMatchObject({
          type: 'upsert', workspace: { workspaceId: second.workspace.workspaceId },
        })
        await expect(nextFrame(iterator)).resolves.toEqual({
          type: 'order', workspaceIds: [second.workspace.workspaceId, first.workspace.workspaceId],
        })
        await controller.insertBefore({
          workspaceId: first.workspace.workspaceId,
          beforeWorkspaceId: second.workspace.workspaceId,
        })
        await expect(nextFrame(iterator)).resolves.toEqual({
          type: 'order',
          workspaceIds: [first.workspace.workspaceId, second.workspace.workspaceId],
        })

        /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const session = ctx.sessions.create(SessionId('archived'), {
          meta: { cwd: first.workspace.path },
        })
        await controller.archiveSession({ sessionId: session.id })
        await expect(nextFrame(iterator)).resolves.toEqual({
          type: 'archived', archivedSessionIds: [session.id],
        })
        await controller.delete({ workspaceId: second.workspace.workspaceId })
        await expect(nextFrame(iterator)).resolves.toEqual({
          type: 'order', workspaceIds: [first.workspace.workspaceId],
        })
        await expect(nextFrame(iterator)).resolves.toEqual({
          type: 'remove', workspaceId: second.workspace.workspaceId,
        })

        abort.abort()
        await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
      })

    it('ignores unrelated domain writes and closes active followers on disposal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：controller、ctx、root 用于处理 controller、ctx、root 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const { controller, ctx, root } = await harness()
        /**
     * 常量说明：abort 用于处理 abort 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const abort = new AbortController()
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = controller.follow(abort.signal)[Symbol.asyncIterator]()
        await nextFrame(iterator)
        ctx.emit('domain/changed', {
          domain: 'other', table: 'records', key: 'x', operation: 'put', value: {},
        })
        ctx.emit('domain/changed', {
          domain: 'workspace', table: '', key: '', operation: 'deleted',
        })
        ctx.emit('domain/changed', {
          domain: 'workspace', table: 'other', key: 'x', operation: 'put', value: {},
        })
        ctx.emit('domain/changed', {
          domain: 'workspace', table: 'workspaces', key: 'unknown', operation: 'deleted',
        })
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = iterator.next()
        /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const created = await controller.create({ path: stageDir(root, 'visible') })
        await expect(pending).resolves.toMatchObject({ value: { type: 'upsert' } })
        await expect(iterator.next()).resolves.toEqual({
          done: false,
          value: { type: 'order', workspaceIds: [created.workspace.workspaceId] },
        })

        /**
     * 常量说明：closing 用于处理 closing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const closing = iterator.next()
        await ctx.fiber.dispose()
        roots.splice(roots.indexOf(ctx), 1)
        await expect(closing).resolves.toEqual({ done: true, value: undefined })
      })
  })
