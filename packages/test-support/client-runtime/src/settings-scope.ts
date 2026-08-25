/** Test double for the client settings-scope seam. */
/*
 * 中文说明：
 * - 文件职责：提供客户端设置作用域的内存测试替身，统一模拟读取、订阅、写入和 Host 发布。
 * - 技术维度：使用 TypeScript 泛型、Set 订阅集合和 Vitest 模拟函数记录调用。
 * - 产品维度：帮助设置界面在不启动真实 Host 的情况下验证加载、保存和刷新体验。
 * - 逻辑维度：先建立加载中快照与写入探针，再返回可订阅作用域和主动发布控制器。
 * - 关键边界：这里只模拟成功写入；发布使用浅合并，不能代表持久化层的完整校验行为。
 * - 新手阅读建议：先看 StubSettingsScope 的四项能力，再沿 stubSettingsScope 的返回对象理解状态传播。
 */
import { vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** Handle over one stubbed scope: the scope, its write spy, and publication controls. */
/* 中文：一个设置作用域测试替身的完整操作句柄，供用例读取状态、检查写入并触发更新。 */
export interface StubSettingsScope<T> {
  /** The scope face handed to the service under test. */
  /* 中文：交给被测服务的设置作用域接口；T 是该设置项的值类型。 */
  scope: SettingsScope<T>
  /** Spy behind `scope.set`; resolves immediately. */
  /* 中文：记录 set 调用的探针；本替身中始终立即成功。 */
  set: ReturnType<typeof vi.fn>
  /** Spy behind `scope.unset`; resolves immediately. */
  /* 中文：记录 unset 调用的探针；本替身中始终立即成功。 */
  unset: ReturnType<typeof vi.fn>
  /** @returns how many listeners are currently subscribed (disposal assertions). */
  /* 中文：返回当前订阅者数量，用于确认组件卸载后已取消订阅。示例：expect(stub.listenerCount()).toBe(0)。 */
  listenerCount(): number
  /**
   * Replace part of the snapshot and notify subscribers, as a Host
   * acceptance would.
   * @param next - snapshot fields to replace.
   */
  /* 中文：以 next 浅合并当前快照并逐一通知订阅者；无返回值。示例：stub.publish({ status: 'ready' })。 */
  publish(next: Partial<SettingsScopeSnapshot<T>>): void
}

/**
 * Build an in-memory settings scope for service specs: starts in the host
 * loading state, records writes, and lets the test publish Host acceptances.
 * @returns the stub handle.
 */
/*
 * 中文：创建初始为 Host 加载态的设置作用域替身；无参数，返回包含作用域、探针和发布控制的句柄。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function stubSettingsScope<T>(): StubSettingsScope<T> {
  /** 当前可读快照；publish 会用新对象替换它，初始值表示 Host 尚未返回设置。 */
  let snapshot: SettingsScopeSnapshot<T> = {
    status: 'loading', value: undefined, base: undefined, user: undefined,
    revision: undefined, writable: false, mode: 'host',
  }
  /** 当前有效的无参更新监听器；Set 同时避免重复注册同一函数。 */
  const listeners = new Set<() => void>()
  /** set 写入探针；参数由 SettingsScope 类型约束，本替身不保存其值。 */
  const set = vi.fn(() => Promise.resolve())
  /** unset 删除探针；本替身不改变快照，需由用例显式 publish Host 接受结果。 */
  const unset = vi.fn(() => Promise.resolve())
  return {
    scope: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        /** listener 是本次订阅的更新回调，返回的清理函数只删除该回调。 */
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set,
      unset,
    },
    set,
    unset,
    listenerCount: () => listeners.size,
    publish: (next) => {
      /** next 只覆盖指定字段，未给出的快照字段保持原值。 */
      snapshot = { ...snapshot, ...next }
      /** 复制集合后遍历，避免监听器在通知期间退订而干扰本轮迭代。 */
      for (const listener of [...listeners]) listener()
    },
  }
}
