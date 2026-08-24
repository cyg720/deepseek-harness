/**
 * Client-namespace projection of the todo domain: a pure re-export of the package's
 * types outlet. Client code imports ONLY the client namespace (repo
 * discipline), so `./client` projects the same single-source content
 * `./types` serves to host consumers — zero duplication.
 *
 * @module @deepseek-ai/dsh-tool-todo/client
 */
/**
 * 文件职责：把待办工具的共享类型投影到客户端专用导入路径。
 * 技术维度：使用 TypeScript 纯类型通配导出，复用 `types.ts` 声明。
 * 产品维度：Web 待办展示可读取事件和条目类型，而不加载模型工具实现。
 * 逻辑维度：从单一类型源转发全部类型到 `./client` 命名空间。
 * 关键边界：不得导出运行时工具；待办事实仍由事件化会话日志拥有。
 * 新手阅读建议：先看 types.ts 的待办字段，再理解此处没有独立逻辑。
 */

export type * from './types.ts'
