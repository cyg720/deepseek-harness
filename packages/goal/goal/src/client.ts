/**
 * Client-namespace projection of the goal domain: a pure re-export of the
 * package's types outlet. Client code imports ONLY the client namespace
 * (repo discipline), so `./client` projects the same single-source content
 * `./types` serves to host consumers — zero duplication.
 *
 * @module @deepseek-ai/dsh-goal/client
 */
/*
 * 文件职责：把目标领域的共享类型投影到浏览器专用导入路径。
 * 技术维度：使用 TypeScript `export type *` 复用单一类型来源，不生成运行时代码。
 * 产品维度：目标栏等客户端功能可读取目标事件和状态类型而不依赖主机实现。
 * 逻辑维度：将 `types.ts` 的全部类型原样转发到 `./client` 出口。
 * 关键边界：只允许类型导出；加入运行时值会破坏客户端命名空间纪律。
 * 新手阅读建议：先到 types.ts 理解目标数据，再回来看该文件只是路径适配器。
 */

export type * from './types.ts'
