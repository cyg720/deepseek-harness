/**
 * Vitest-wide invariant host. Ordinary Cordis roots receive the invariant
 * service with global enablement plus the current test package's companion.
 * One topology test mounts every companion; focused invariant tests own their
 * service topology explicitly.
 */
/*
 * 文件职责：实现 test-invariants.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */

import { expect } from 'vitest'
import { FiberState, Inject, RegistryService, ValidationError } from '@deepseek-ai/cordis'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

declare global {
  /** 中文说明：interface ImportMeta 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
  interface ImportMeta {
    /** Lazy Vite module-glob expansion used by the Vitest setup file. */
    glob<TModule>(pattern: string): Record<string, () => Promise<TModule>>
  }
}

/** Loader-safe exports shared by every package invariant companion. */
/* 中文说明：interface TestInvariantCompanion 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
export interface TestInvariantCompanion {
  readonly name: string
  readonly inject: readonly string[]
  readonly default?: unknown
  apply(ctx: Context): Promise<() => void>
}

/** Private service dependency that holds ordinary root plugins until invariant startup completes. */
/* 中文说明：常量 TEST_INVARIANT_READY_SERVICE 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const TEST_INVARIANT_READY_SERVICE = 'testInvariantReady'

/**
 * Every package companion as a lazy loader keyed by glob path. Ordinary tests
 * load only their owner's module; the exhaustive topology test loads and
 * executes all of them, so aggregated coverage still observes every
 * registration while per-file setup stops importing 168 companions and their
 * transitive package sources.
 */
/* 中文说明：函数值 testInvariantCompanions 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
export const testInvariantCompanions: Readonly<Record<string, () => Promise<TestInvariantCompanion>>> =
  import.meta.glob<TestInvariantCompanion>('../packages/*/*/src/invariant.ts')

/** Manual-topology suites whose names cannot follow the focused invariant convention. */
/* 中文说明：常量 MANUAL_INVARIANT_TEST_EXCEPTIONS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const MANUAL_INVARIANT_TEST_EXCEPTIONS = [
  '/packages/runtime-diagnostics/invariants/tests/service.spec.ts',
  '/packages/examples/agent-spine-demo/tests/agent-core.spec.ts',
] as const

/** 中文说明：interface InvariantHost 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface InvariantHost {
  readonly byCallback: ReadonlyMap<unknown, PluginFiber>
  readonly barrierOwners: WeakSet<Context['fiber']>
  readonly ready: Promise<void>
}

/** 中文说明：type PluginFiber 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type PluginFiber = ReturnType<RegistryService['plugin']>
/** 中文说明：type PluginCallback 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type PluginCallback = Plugin.Function | Plugin.Constructor

/** 中文说明：变量 hosts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const hosts = new WeakMap<Context, InvariantHost>()
/** 中文说明：变量 originalPlugin 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
// oxlint-disable-next-line typescript/unbound-method -- every call below supplies its RegistryService receiver explicitly.
const originalPlugin = RegistryService.prototype.plugin

RegistryService.prototype.plugin = function(plugin: Plugin, config?: unknown, getOuterStack?: () => string[]) {
  /** 中文说明：变量 testPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const testPath = expect.getState().testPath ?? ''
  if (usesManualInvariantTree(testPath)) return originalPlugin.call(this, plugin, config, getOuterStack)

  /** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = this.ctx.root
  /** 中文说明：变量 host 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const host = hosts.get(root) ?? startInvariantHost(root)
  /** 中文说明：变量 callback 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const callback = this.resolve(plugin)
  /** 中文说明：变量 existing 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const existing = callback === undefined ? undefined : host.byCallback.get(callback)
  if (existing !== undefined) {
    return hasBarrierOwner(host, this.ctx) ? existing : joinInvariantStartup(existing, host.ready)
  }

  // Causal descendants of a gated target have already crossed the barrier.
  // Host service and companion descendants also bypass it so their own startup
  // cannot depend on the readiness they are responsible for providing.
  if (hasBarrierOwner(host, this.ctx)) {
    return originalPlugin.call(this, plugin, config, getOuterStack)
  }
  if (callback === undefined) {
    return originalPlugin.call(this, plugin, config, getOuterStack)
  }

  /** 中文说明：变量 fiber 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = originalPlugin.call(
    this,
    withInvariantReadiness(plugin, callback as PluginCallback),
    config,
    getOuterStack,
  )
  /** 中文说明：变量 initiallyPending 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const initiallyPending = fiber.ctx.fiber.state === FiberState.PENDING
  host.barrierOwners.add(fiber.ctx.fiber)
  return joinInvariantStartup(fiber, host.ready, initiallyPending)
}

/**
 * Detect focused suites that construct service selection or companion lifecycle explicitly.
 * @param testPath - absolute or repo-relative Vitest file path.
 * @returns whether the global invariant host must leave the root untouched.
 */
/* 中文说明：函数 usesManualInvariantTree 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function usesManualInvariantTree(testPath: string): boolean {
  /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalized = testPath.replaceAll('\\', '/')
  if (/\/packages\/[^/]+\/[^/]+\/tests\/[^/]*invariant[^/]*\.spec\.ts$/.test(normalized)) return true
  return MANUAL_INVARIANT_TEST_EXCEPTIONS.some(path => normalized.endsWith(path))
}

/** 中文说明：常量 ALL_COMPANION_TESTS 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ALL_COMPANION_TESTS = ['/scripts/test-invariants.spec.ts'] as const
/** 中文说明：常量 ATTACHMENT_COMPANION 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ATTACHMENT_COMPANION = '../packages/attachment/attachment-local/src/invariant.ts'

/** 中文说明：class TestAttachmentStore 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class TestAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1,
    maxImagePixels: 1,
    maxImageDimension: 1,
    mediaTypes: ['image/png'],
  }

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.reject(new Error('test invariant attachment store does not validate images'))
  }

  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('test invariant attachment store does not save images'))
  }

  readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('test invariant attachment store does not read images'))
  }
}

/**
 * Select the package companions that an ordinary test root must register.
 * Package tests receive their owner's checks; the dedicated topology test
 * receives every owner so coverage and exhaustive runtime registration remain
 * independently enforced.
 * @param testPath - absolute or repo-relative normalized Vitest file path.
 * @returns sorted `import.meta.glob` keys for companions to mount.
 */
/* 中文说明：函数 testInvariantCompanionPaths 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function testInvariantCompanionPaths(testPath: string): string[] {
  /** 中文说明：变量 normalized 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const normalized = testPath.replaceAll('\\', '/')
  /** 中文说明：变量 allPaths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const allPaths = Object.keys(testInvariantCompanions).sort()
  if (ALL_COMPANION_TESTS.some(path => normalized.endsWith(path))) return allPaths

  /** 中文说明：变量 owner 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const owner = normalized.match(/\/packages\/([^/]+)\/([^/]+)\/tests\//)
  if (owner === null) return []
  /** 中文说明：变量 companionPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const companionPath = `../packages/${owner[1]}/${owner[2]}/src/invariant.ts`
  if (testInvariantCompanions[companionPath] === undefined) {
    throw new Error(`test invariants: package test has no companion at ${companionPath}`)
  }
  return [companionPath]
}

/** 中文说明：函数 startInvariantHost 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function startInvariantHost(root: Context): InvariantHost {
  /** 中文说明：变量 byCallback 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const byCallback = new Map<unknown, PluginFiber>()
  /** 中文说明：变量 barrierOwners 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const barrierOwners = new WeakSet<Context['fiber']>()
  /** 中文说明：函数值 mount 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const mount = (plugin: Plugin, config?: unknown): PluginFiber => {
    /** 中文说明：变量 fiber 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = originalPlugin.call(root.registry, plugin, config)
    /** 中文说明：变量 callback 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const callback = root.registry.resolve(plugin)
    if (callback === undefined) throw new Error('test invariants: companion is not a valid Cordis plugin')
    byCallback.set(callback, fiber)
    barrierOwners.add(fiber.ctx.fiber)
    return fiber
  }

  // The service mounts synchronously so the intercepted registration that
  // started this host immediately finds its own fiber in byCallback.
  // Companions load and mount inside the ready chain (after the service is
  // active, so their startup is directly joinable); every joined root plugin
  // awaits ready, so none starts ahead of its package checks. Tests plugging
  // a companion directly must await an earlier root plugin first — the
  // duplicate-mount failure otherwise is loud (owner name already reserved).
  /** 中文说明：变量 serviceFiber 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const serviceFiber = mount(InvariantRegistry, { enabled: true })
  /** 中文说明：变量 testPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const testPath = expect.getState().testPath ?? ''
  /** 中文说明：变量 companionPaths 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const companionPaths = testInvariantCompanionPaths(testPath)
  /** 中文说明：函数值 ready 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const ready = requireActive(serviceFiber, 'invariant service').then(async () => {
    /** 中文说明：变量 attachmentFiber 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const attachmentFiber = companionPaths.includes(ATTACHMENT_COMPANION)
      ? mount(TestAttachmentStore)
      : undefined
    /** 中文说明：函数值 companions 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const companions = await Promise.all(companionPaths.map(async (path) => {
      /** 中文说明：变量 load 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const load = testInvariantCompanions[path]
      if (load === undefined) {
        throw new Error(`test invariants: selected companion vanished at ${path}`)
      }
      /** 中文说明：变量 companion 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const companion = await load()
      if (!companion.inject.includes('invariants')) {
        throw new Error(`test invariants: ${path} must inject the invariant service`)
      }
      return { companion, path }
    }))
    /** 中文说明：函数值 companionFibers 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const companionFibers = companions.map(({ companion, path }) => ({
      fiber: mount(companion),
      path,
    }))
    await Promise.all([
      ...(attachmentFiber === undefined
        ? []
        : [requireActive(attachmentFiber, 'test attachment store')]),
      ...companionFibers.map(({ fiber, path }) => requireActive(fiber, path)),
    ])
    root.provide(TEST_INVARIANT_READY_SERVICE, true)
  })
  /** 中文说明：变量 host 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const host = { byCallback, barrierOwners, ready }
  hosts.set(root, host)
  return host
}

/** 中文说明：函数 hasBarrierOwner 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function hasBarrierOwner(host: InvariantHost, ctx: Context): boolean {
  /** 中文说明：变量 fiber 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let fiber = ctx.fiber
  while (true) {
    if (
      host.barrierOwners.has(fiber)
      && (fiber.state === FiberState.LOADING || fiber.state === FiberState.ACTIVE)
    ) {
      return true
    }
    /** 中文说明：变量 parent 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = fiber.parent.fiber
    if (parent === fiber) return false
    fiber = parent
  }
}

/** 中文说明：函数 requireActive 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
async function requireActive(fiber: PluginFiber, label: string): Promise<void> {
  await fiber.await()
  if (fiber.state !== FiberState.ACTIVE) {
    throw new Error(`test invariants: ${label} settled without becoming active`)
  }
}

/** 中文说明：函数 withInvariantReadiness 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function withInvariantReadiness(plugin: Plugin, callback: PluginCallback): Plugin.Object {
  return {
    apply: callback as Plugin.Function,
    inject: {
      ...Inject.resolve(plugin.inject),
      [TEST_INVARIANT_READY_SERVICE]: null,
    },
    ...(plugin.name === undefined ? {} : { name: plugin.name }),
    ...(plugin.Config === undefined ? {} : { Config: plugin.Config }),
    ...(plugin.provide === undefined ? {} : { provide: plugin.provide }),
    ...(plugin.intercept === undefined ? {} : { intercept: plugin.intercept }),
  }
}

/** 中文说明：函数 joinInvariantStartup 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function joinInvariantStartup(
  fiber: PluginFiber,
  invariantReady: Promise<void>,
  disposePendingValidationFailure = false,
): PluginFiber {
  // RegistryService returns a thenable wrapper whose context still points to
  // the raw Fiber. Calling inherited await() on the wrapper would return and
  // assimilate that thenable, accidentally following later plugin startup.
  /** 中文说明：变量 rawFiber 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const rawFiber = fiber.ctx.fiber
  /** 中文说明：函数值 readiness 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const readiness = invariantReady.then(async () => {
    try {
      return await rawFiber.await()
    } catch (error) {
      // Config resolves only after the readiness injection activates. Dispose
      // validation failures owned by an initially pending target; ordinary
      // callback failures remain inspectable.
      if (disposePendingValidationFailure && error instanceof ValidationError) {
        await rawFiber.dispose()
      }
      throw error
    }
  })
  /** 中文说明：变量 joined 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const joined = Object.create(fiber) as PluginFiber
  joined.then = readiness.then.bind(readiness)
  return joined
}
