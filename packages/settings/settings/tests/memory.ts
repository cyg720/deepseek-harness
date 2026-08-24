/**
 * In-memory settings provider fixture: the smallest real subclass of the Service Definition,
 * used by the base-class behavior suite in place of a file- or network-backed
 * provider. Kept in `tests/` because production providers live in their own
 * packages.
 */
/**
 * 中文说明：
 * - 文件职责：提供 SettingsProvider 的最小内存实现，供基类行为测试控制存储、写权限和延迟。
 * - 技术维度：使用 TypeScript 继承、受保护钩子、structuredClone 和可配置异步等待。
 * - 产品维度：在无需真实文件或网络的情况下验证设置读取、并发更新及外部变更通知。
 * - 逻辑维度：构造时复制初始文档，load 返回副本，persist 记录并更新，pushExternal 主动发布。
 * - 关键边界：只用于测试；所有数据均在内存，复制要求值可被 structuredClone 处理。
 * - 新手阅读建议：先阅读 SettingsProvider 的抽象钩子，再看本类如何用四个公开字段暴露测试控制点。
 */

import { SettingsProvider, type SettingsNamespace } from '../src/index.ts'

/** In-memory provider exposing the protected provider hooks to tests. */
/** 中文：面向测试的内存设置提供者，用于模拟加载、保存、只读状态、延迟和外部更新。 */
export class MemorySettings extends SettingsProvider {
  /** Raw document the provider "storage" currently holds. */
  /** 中文：当前内存存储的原始设置文档；键为命名空间。 */
  doc: Record<string, unknown>
  /** Every persist() call observed, in order. */
  /** 中文：按发生顺序记录的所有持久化调用，初始为空。 */
  persisted: Array<{ ns: SettingsNamespace; section: Record<string, unknown> }> = []
  /** When false, update() must reject before reaching persist(). */
  /** 中文：写权限开关；false 时基类应在调用 persist 前拒绝更新。 */
  writableFlag: boolean

  /** Artificial persist latency so tests can interleave concurrent updates. */
  /** 中文：人为持久化延迟毫秒数；0 表示不等待，正数用于编排并发。 */
  persistDelayMs: number

  /** 中文：创建内存提供者；ctx 是 Cordis 上下文，options 可给初始文档、可写性和延迟。示例：new MemorySettings(ctx, { writable: false })。 */
  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: {
    doc?: Record<string, unknown>
    writable?: boolean
    persistDelayMs?: number
  }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
    this.writableFlag = options?.writable ?? true
    this.persistDelayMs = options?.persistDelayMs ?? 0
  }

  /** 中文：返回当前 writableFlag，供基类在更新前检查；无参数。 */
  get writable(): boolean {
    return this.writableFlag
  }

  /** 中文：加载当前文档的深拷贝；无参数，返回已完成 Promise，调用方不能直接修改内部存储。 */
  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  /** 中文：保存一个命名空间；ns 是键，section 是值，无返回数据，可按 persistDelayMs 延迟。 */
  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    if (this.persistDelayMs > 0) {
      /** resolve 是计时器到期时调用的完成回调。 */
      await new Promise(resolve => setTimeout(resolve, this.persistDelayMs))
    }
    this.persisted.push({ ns, section: structuredClone(section) })
    this.doc[ns] = structuredClone(section)
  }

  /** Simulate an external storage change reaching the provider. */
  /** 中文：用 doc 替换内存文档并发布副本；无返回值。示例：settings.pushExternal({ ui: {} })。 */
  pushExternal(doc: Record<string, unknown>): void {
    this.doc = structuredClone(doc)
    this.publish(structuredClone(doc))
  }
}
