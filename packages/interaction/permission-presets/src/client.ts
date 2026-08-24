/**
 * Client-namespace projection of the permission domain: a pure re-export of
 * the package's types outlet. Client code imports ONLY the client namespace
 * (repo discipline), so `./client` projects the same single-source content
 * `./types` serves to host consumers — zero duplication.
 *
 * @module @deepseek-ai/dsh-permission-presets/client
 */
/**
 * 文件职责：把权限预设领域类型投影到客户端专用导入路径。
 * 技术维度：使用纯类型通配导出，避免复制主机与浏览器共享声明。
 * 产品维度：权限设置界面可获得预设和选择结果类型，而不加载主机服务。
 * 逻辑维度：将 `types.ts` 的类型原样暴露为 `./client` 出口。
 * 关键边界：不得导出运行时实现；客户端权限界面也不能替代执行端授权校验。
 * 新手阅读建议：先读 types.ts 的预设字段，再理解这里仅提供合规导入路径。
 */

export type * from './types.ts'
