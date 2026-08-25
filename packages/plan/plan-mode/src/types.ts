/**
 * Pure types of the plan domain: the ONE home of the `plan` projection-key
 * declaration, free of this package's host-side value imports (cordis
 * service, dsh-tools, dsh-agent). Two namespace projections serve it —
 * `./types` for host consumers, `./client` for client aggregates — with zero
 * content duplication.
 *
 * @module @deepseek-ai/dsh-plan-mode/types
 */
/*
 * 文件职责：定义计划模式投影的纯类型，并扩展会话投影键映射。
 * 技术维度：使用 TypeScript 接口与模块声明合并，在不引入宿主运行时代码的前提下共享类型。
 * 产品维度：让客户端和宿主都能一致展示当前计划模式及尚未落实的切换请求。
 * 逻辑维度：先定义 PlanProjection 的两个布尔字段，再把 plan 键登记到 SessionProjectionMap。
 * 关键边界：能力未装配时 plan 键应缺失，不能用两个 false 冒充能力存在。
 * 新手阅读建议：先分清 active 与 pending 的时间含义，再学习 declare module 如何扩展外部接口。
 */

/**
 * The plan projection's wire value. `active` is the logged state in force
 * (the last `plan/mode`, inactive before the first); `pending` is true while
 * a logged `/plan` selection targets a state other than `active`, has not
 * failed through its paired `command/done`, and no later `plan/mode` event has
 * recorded that state. Capability absence (plan-mode not composed) is the
 * key's absence, never a value.
 */
/* 会话中计划协作状态的线协议值；能力缺失由整个 plan 键缺失表示。 */
export interface PlanProjection {
  // 已由最新 plan/mode 事件确认的状态；首次事件前为 false。
  active: boolean
  // 已选择但尚未成功写入对应 plan/mode 状态的请求；失败或被后续事件取代后为 false。
  pending: boolean
}

// 扩展会话投影的公共类型映射，使宿主和客户端都能按 plan 键取得同一类型。
declare module '@deepseek-ai/dsh-session-projection/types' {
  // 会话投影可扩展字段的声明；这里只添加计划模式所属的键。
  interface SessionProjectionMap {
    /** Plan collaboration state folded from the plan command lifecycle and `plan/mode` events. */
    /* 由计划命令生命周期和 plan/mode 事件折叠得到的计划协作状态。 */
    plan: PlanProjection
  }
}
