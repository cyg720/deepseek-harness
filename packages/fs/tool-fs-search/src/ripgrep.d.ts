/**
 * Minimal type surface for the `@vscode/ripgrep` package: an ESM module that
 * resolves the platform ripgrep binary (`@vscode/ripgrep-<platform>-<arch>`
 * optional dependency) and exports its absolute path as the named export
 * `rgPath` (no bundled type declarations).
 * @module @deepseek-ai/dsh-tool-fs-search/ripgrep-types
 */
/**
 * 文件职责：补足 `@vscode/ripgrep` 缺失的最小 TypeScript 类型声明。
 * 技术维度：使用环境模块声明，只暴露平台可执行文件的绝对路径。
 * 产品维度：文件搜索工具可调用随包分发的 ripgrep，而无需用户手工安装。
 * 逻辑维度：声明第三方模块，并导出唯一的 `rgPath` 字符串常量。
 * 关键边界：路径是否可执行由可选平台包决定；这里不模拟第三方包其他 API。
 * 新手阅读建议：先看 rgPath 的使用点，再理解平台可选依赖如何提供二进制。
 */

declare module '@vscode/ripgrep' {
  /** Absolute path to the packaged ripgrep executable for the current platform. */
  /** 当前平台随包安装的 ripgrep 绝对路径；只读使用，不应拼接为其他命令。 */
  export const rgPath: string
}
