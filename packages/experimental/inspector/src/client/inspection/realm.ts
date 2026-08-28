/** Stable Client source identity with a fresh descriptor for each WebSocket generation.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 realm 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { inspectorId } from '../../shared/identity.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import { bridgeCapabilities } from '../cdp/index.ts'

/**
 * 常量说明：CLIENT_SOURCE_STORAGE_KEY 用于处理 CLIENT_SOURCE_STORAGE_KEY 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const CLIENT_SOURCE_STORAGE_KEY = 'dsh.experimental-inspector.client-source-id.v0'
/**
 * 常量说明：CLIENT_SOURCE_LOCK_PREFIX 用于处理 CLIENT_SOURCE_LOCK_PREFIX 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const CLIENT_SOURCE_LOCK_PREFIX = 'dsh.experimental-inspector.client-source:'

/** Owns one browser realm's stable source id across transport reconnects.
 * @remarks 中文说明：类说明：ClientRealmSource 用于集中封装 处理 ClientRealmSource 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class ClientRealmSource {
  /** Logical source id retained across reconnecting transport generations.
   * @remarks 中文说明：常量说明：sourceId 用于处理 sourceId 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly sourceId: InspectorSourceDescriptor['sourceId']

  /**
   * 功能说明：处理 ClientRealmSource 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sourceId （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param releaseClaim （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientRealmSource(label, sourceId, releaseClaim) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly label: string,
    sourceId = sessionClientSourceId(),
    private releaseClaim?: () => void,
  ) {
    this.sourceId = sourceId
  }

  /**
   * Claim the tab identity before opening its source transport. Browsers with
   * Web Locks reject a copied `sessionStorage` identity while its original tab
   * remains live; a fresh id is persisted and claimed instead.
   * @param label - Human-readable Client label reported to the Worker.
   * @returns The claimed realm source.
   * @remarks 中文说明：功能说明：处理 claim 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：label（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ClientRealmSource>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 claim(label)，并按返回类型处理结果。
   */
  static async claim(label: string): Promise<ClientRealmSource> {
    /**
     * 变量说明：sourceId 用于处理 sourceId 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let sourceId = sessionClientSourceId()
    /**
     * 常量说明：locks 用于处理 locks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const locks = browserLockManager()
    if (locks === undefined) return new ClientRealmSource(label, sourceId)
    while (true) {
      /**
       * 常量说明：release 用于处理 release 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const release = await tryClaimSourceId(locks, sourceId)
      if (release !== undefined) {
        persistClientSourceId(sourceId)
        return new ClientRealmSource(label, sourceId, release)
      }
      sourceId = generatedClientSourceId()
    }
  }

  /**
   * Create the descriptor for one newly admitted transport generation.
   * @param hasSources - Whether the built Client bundle is available for source reads.
   * @returns A source descriptor with a fresh generation.
   * @remarks 中文说明：功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：hasSources（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：InspectorSourceDescriptor；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 connect(hasSources)，并按返回类型处理结果。
   */
  connect(hasSources: boolean): InspectorSourceDescriptor {
    return {
      sourceId: this.sourceId,
      generation: inspectorId<'InspectorSourceGeneration'>(randomUUID(), 'generation'),
      kind: 'client',
      label: this.label,
      timeOriginMs: performance.timeOrigin,
      capabilities: bridgeCapabilities(clientOrigin(), hasSources),
    }
  }

  /** Release this page's identity claim.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.releaseClaim?.()
    this.releaseClaim = undefined
  }
}

/**
 * 功能说明：处理 sessionClientSourceId 相关流程；使用场景由所在模块及调用位置决定。
 * @returns InspectorSourceDescriptor['sourceId']；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 sessionClientSourceId()，并按返回类型处理结果。
 */
function sessionClientSourceId(): InspectorSourceDescriptor['sourceId'] {
  /**
   * 常量说明：generated 用于处理 generated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const generated = generatedClientSourceId()
  try {
    /**
     * 常量说明：stored 用于处理 stored 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stored = sessionStorage.getItem(CLIENT_SOURCE_STORAGE_KEY)
    if (stored !== null) {
      try {
        return inspectorId<'InspectorSourceId'>(stored, 'sourceId')
      } catch {
        // Invalid page-owned storage is replaced with a fresh protocol identity below.
      }
    }
    sessionStorage.setItem(CLIENT_SOURCE_STORAGE_KEY, generated)
  } catch {
    // Disabled or unavailable session storage limits identity to this page lifetime.
  }
  return generated
}

/**
 * 功能说明：处理 generatedClientSourceId 相关流程；使用场景由所在模块及调用位置决定。
 * @returns InspectorSourceDescriptor['sourceId']；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 generatedClientSourceId()，并按返回类型处理结果。
 */
function generatedClientSourceId(): InspectorSourceDescriptor['sourceId'] {
  return inspectorId<'InspectorSourceId'>(`client-${randomUUID()}`, 'sourceId')
}

/**
 * 功能说明：处理 persistClientSourceId 相关流程；使用场景由所在模块及调用位置决定。
 * @param sourceId （InspectorSourceDescriptor['sourceId']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 persistClientSourceId(sourceId)，并按返回类型处理结果。
 */
function persistClientSourceId(sourceId: InspectorSourceDescriptor['sourceId']): void {
  try {
    sessionStorage.setItem(CLIENT_SOURCE_STORAGE_KEY, sourceId)
  } catch {
    // Disabled or unavailable session storage limits identity to this page lifetime.
  }
}

/**
 * 功能说明：处理 browserLockManager 相关流程；使用场景由所在模块及调用位置决定。
 * @returns LockManager | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 browserLockManager()，并按返回类型处理结果。
 */
function browserLockManager(): LockManager | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator.locks
}

/**
 * 功能说明：处理 tryClaimSourceId 相关流程；使用场景由所在模块及调用位置决定。
 * @param locks （LockManager）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param sourceId （InspectorSourceDescriptor['sourceId']）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Promise<(() => void) | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 tryClaimSourceId(locks, sourceId)，并按返回类型处理结果。
 */
function tryClaimSourceId(
  locks: LockManager,
  sourceId: InspectorSourceDescriptor['sourceId'],
): Promise<(() => void) | undefined> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  return new Promise((resolve, reject) => {
    /**
     * 变量说明：release 用于处理 release 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let release!: () => void
    /**
     * 常量说明：held 用于处理 held 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：released（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(released)，并按返回类型处理结果。
     */
    const held = new Promise<void>((released) => { release = released })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：lock（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(lock)，并按返回类型处理结果。
     */
    void locks.request(`${CLIENT_SOURCE_LOCK_PREFIX}${sourceId}`, { ifAvailable: true }, async (lock) => {
      if (lock === null) {
        resolve(undefined)
        return
      }
      resolve(release)
      await held
    }).catch(reject)
  })
}

/**
 * 功能说明：处理 clientOrigin 相关流程；使用场景由所在模块及调用位置决定。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 clientOrigin()，并按返回类型处理结果。
 */
function clientOrigin(): string {
  /**
   * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const location = Reflect.get(globalThis, 'location') as unknown
  if (typeof location !== 'object' || location === null) return ''
  /**
   * 常量说明：origin 用于处理 origin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const origin = Reflect.get(location, 'origin') as unknown
  return typeof origin === 'string' ? origin : ''
}
