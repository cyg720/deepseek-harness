/** 预设 Loader 条目重启时保留其已授予的重绑定句柄，不向其他条目开放作用域改写。 */
import type { ScopeKey, ScopeParentBinding } from '@deepseek-ai/dsh-scope'

const owners = new WeakMap<object, WeakMap<ScopeKey, ScopeParentBinding>>()

/**
 * 返回同一注册所有者持有的绑定；所有者与 Agent 作用域均为弱引用键。
 * @param owner - 稳定 Loader 条目；直接装配时为当前服务实例。
 * @returns 仅此所有者可复用的作用域绑定表。
 */
export function presetScopeBindings(owner: object): WeakMap<ScopeKey, ScopeParentBinding> {
  let bindings = owners.get(owner)
  if (bindings === undefined) {
    bindings = new WeakMap<ScopeKey, ScopeParentBinding>()
    owners.set(owner, bindings)
  }
  return bindings
}
