/**
 * Pure types of the todo domain: the ONE home of the `todos` projection-key
 * declaration plus its payload types, free of this package's host-side value
 * imports (dsh-tools, zod). Two namespace projections serve it — `./types`
 * for host consumers, `./client/types` (the browser half-entry's re-export)
 * for client aggregates — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-tool-todo/types
 */
/**
 * 文件职责：集中声明待办领域的纯类型、会话投影键和整体列表载荷。
 * 技术维度：使用 TypeScript 模块扩充和类型重导出，保持主机与浏览器类型入口零重复。
 * 产品维度：让模型写入的最新待办清单可被会话恢复、客户端显示和其他插件统一读取。
 * 逻辑维度：重用 Session 的 TodoItem，再为投影状态与投影查询同时增加 todos 字段。
 * 关键边界：todo/write 每次携带完整替换列表，折叠采用最后写入获胜；首次写入前为 null。
 * 新手阅读建议：先区分 null 与空数组，再沿 todo/write 事件查看投影如何更新。
 */

import type { TodoItem } from '@deepseek-ai/dsh-session/types'

// TodoItem 类型重导出：让调用方无需直接依赖 session/types 即可使用同一条目定义。
export type { TodoItem } from '@deepseek-ai/dsh-session/types'

// 模块扩充：为会话投影类型注册待办领域拥有的 todos 键。
declare module '@deepseek-ai/dsh-session-projection/types' {
  // SessionProjectionStateMap：投影内部状态中的完整待办列表或首次写入前的 null。
  interface SessionProjectionStateMap {
    todos: TodoItem[] | null
  }
  interface SessionProjectionMap {
    /**
     * The agent's current whole todo list (the latest `todo/write` snapshot),
     * or `null` before the first write. Whole-value rule: every `todo/write`
     * carries the complete replacement list, so the fold is last-wins.
     */
    /**
     * 代理当前完整待办列表，即最新 todo/write 快照；首次写入前为 null。
     * 每次事件都是整体替换，因此折叠规则是最后一次写入获胜。
     */
    todos: TodoItem[] | null
  }
}
