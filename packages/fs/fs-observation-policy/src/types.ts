/*
 * ================================ 文件注释 ================================
 * 【文件职责】fs-observation-policy 插件的词汇：一个最小化的"工具执行上下文"结构，
 * 用于把 fs/* 事件携带的不透明 object actor 收窄成"观察态拥有者"。
 * 【技术维度】纯类型模块：定义 FsObservationActor 接口，只声明 agent.session 两个
 * 可选字段；提供者词汇（FsTarget/FsVersion/写/编辑请求类型）复用 dsh-fs，本包只拥有
 * 建立在其上的"观察态拥有者"结构。
 * 【产品维度】让策略插件不 import dsh-tools/dsh-agent/dsh-session 也能从事件 actor
 * 里取出会话身份，从而按会话隔离"谁观察到过哪个文件"。
 * 【逻辑维度】按出现顺序：模块注释 → FsObservationActor（actor 的最小结构视图）。
 * 【关键边界】session 被视为不透明对象身份（仅作 WeakMap 键），本包绝不读它的任何
 * 字段；agent 不存在时 owner 推导结果为 undefined（此类调用不参与观察态策略）。
 * 【新手阅读建议】看接口注释理解 agent/session 两层的用途即可。
 * ==========================================================================
 */
/**
 * Vocabulary for the fs-observation-policy plugin: the minimal execution-context
 * fields used to derive an observed-state owner by narrowing the opaque `object`
 * actor the `fs/*` events carry.
 *
 * The provider vocabulary (`FsTarget`, `FsVersion`, write/edit request types) is
 * re-used from `@deepseek-ai/dsh-fs`; this package owns only the observed-state
 * owner structure on top of it.
 *
 * @module @deepseek-ai/dsh-fs-observation-policy/types
 */
/**
 * 模块总览：本文件只有一个接口。观察态策略插件用它在不依赖 dsh-tools 等包的前提下，
 * 从事件携带的不透明 actor 里推导"观察态拥有者"（通常是活动会话）。
 */

/**
 * Minimal structural view of a tool execution the policy plugin needs to derive
 * an observed-state owner. `@deepseek-ai/dsh-tools`' `ToolExecution` contains
 * these fields, so the tool passes its `exec` straight through as the opaque
 * `object` actor on the `fs/*` events; this plugin narrows that actor to
 * `FsObservationActor` without importing `dsh-tools`, `dsh-agent`, or `dsh-session`.
 *
 * The owner is `agent.session` when present. It is treated as an opaque object
 * identity (a `WeakMap` key); this package never reads any of its fields.
 */
/*
 * 策略插件需要的"工具执行"最小结构视图。dsh-tools 的 ToolExecution 包含这些字段，
 * 因此工具把它的 exec 原样作为 fs/* 事件的不透明 object actor 传过来；本插件把
 * actor 收窄成 FsObservationActor，而不必 import dsh-tools/dsh-agent/dsh-session。
 * 拥有者是存在时的 agent.session——被当作不透明对象身份（WeakMap 键），本包绝不读
 * 它的任何字段。
 */
export interface FsObservationActor {
  /** The agent on whose behalf the call runs, when there is one. */
  /* 代行本次调用的 agent（存在时才有）。 */
  agent?: {
    /** The session that owns observed-file state, used as an opaque key. */
    /* 拥有"观察到的文件状态"的会话，仅用作不透明键。 */
    session?: object
  }
}
