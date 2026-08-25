/*
 * ================================ 文件注释 ================================
 * 【文件职责】session-projection 的纯类型出口：两张可合并扩展的类型表
 *   （客户端视图表 SessionProjectionMap、宿主折叠状态表 SessionProjectionStateMap）。
 * 【技术维度】纯类型模块，客户端聚合可直接导入而不拖入宿主侧 Cordis 声明合并。
 * 【产品维度】领域包（如 dsh-subagent）通过声明合并把自己的投影键注册进来，
 *   查询/前端/React hooks 共享同一张表。
 * 【逻辑维度】两张空接口，靠声明合并填充。
 * 【关键边界】视图值是 wire-JSON 整值；宿主状态必须是纯 JSON（可持久化）。
 * 【新手阅读建议】搜索"SessionProjectionMap"的声明合并即可看到现有投影键。
 * ==========================================================================
 */

/**
 * Pure-type outlet of the session-projection Service Definition: the one projection type
 * table, importable from client aggregates without dragging the host-side
 * cordis Context merges of the package root (dsh-agent → dsh-session). Domain
 * packages may declare-merge through either the package root or this outlet —
 * re-export preserves symbol identity, so both land on the same table.
 *
 * @module @deepseek-ai/dsh-session-projection/types
 */

/**
 * The merge-extensible client projection table shared by wire blocks, client
 * cells, and React hooks. Domain packages merge their client-visible key here;
 * values are wire-JSON whole values. How a value is rendered is the slot
 * system's business, never this layer's.
 */
// 中文：客户端可合并扩展的投影表：领域包在此合并自己"客户端可见"的投影键；
// 值是 wire-JSON 整值；如何渲染由插槽系统负责，不归本层管。
export interface SessionProjectionMap {}

/**
 * The merge-extensible host fold-state table. Each client-visible key also
 * appears in {@link SessionProjectionMap}; host-only keys appear only here.
 * Values must be plain JSON so the projection cache can persist them.
 */
// 中文：宿主可合并扩展的折叠状态表：客户端可见的键同时出现在 SessionProjectionMap；
// 仅宿主可见的键只出现在这里。值必须是纯 JSON，投影缓存才能持久化。
export interface SessionProjectionStateMap {}
