/*
 * 文件说明：文件职责：实现 api/session-controller 中 remote events 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：SESSION_CONTROLLER_REMOTE_EVENTS 用于处理
 * SESSION_CONTROLLER_REMOTE_EVENTS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */

/** Session Controller events available to a Remote Event assembly. */
type SessionControllerRemoteEvent =
  | 'api-session/activity'
  | 'api-session/added'
  | 'api-session/error'
  | 'api-session/removed'
  | 'api-session/status'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteEventSelection extends
    Record<SessionControllerRemoteEvent, true> {}
}

export {}
