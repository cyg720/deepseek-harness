/**
 * Vocabulary for the spill-policy plugin: the minimal structural view of a tool
 * execution the policy needs to derive the owning session for a spill artifact.
 *
 * `@deepseek-ai/dsh-tools`' `ToolExecution` satisfies this shape, so the policy
 * reads `exec` straight through without importing `dsh-tools` or `dsh-agent`.
 * Only the session HEADER id is read — the same identity every other subsystem
 * keys off (see `dsh-tool-bash`'s owner derivation).
 *
 * @module @deepseek-ai/dsh-spill-policy/types
 */
/**
 * 文件职责：声明溢出策略从工具执行对象中读取会话所有者所需的最小结构类型。
 * 技术维度：使用 TypeScript 结构类型和品牌化 SessionId，避免依赖完整 tools 或 agent 包。
 * 产品维度：把过大的工具输出安全归属到正确会话，同时保持策略包依赖轻量。
 * 逻辑维度：可选 agent 逐层包含 session、header 和作为溢出物所有者的 id。
 * 关键边界：只读取会话头标识；没有 agent 的工具执行允许省略整个字段，调用方必须处理。
 * 新手阅读建议：从最内层 id 向外阅读，理解哪些层必需、哪一层允许缺失。
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** Minimal structural view of a tool execution: the owning session's header id, when present. */
/** SpillPolicyExec：工具执行的最小结构视图，只暴露可选代理及其会话头身份。 */
export interface SpillPolicyExec {
  /** The agent on whose behalf the call runs, when there is one. */
  /** agent：代表其执行工具调用的代理；无代理调用时可以缺失。 */
  agent?: {
    /** session：代理当前拥有的会话对象。 */
    session: {
      /** header：保存会话稳定身份的持久头部。 */
      header: {
        /** The canonical session identity — the spill owner. */
        /** id：规范品牌化会话标识，也是溢出文件的所有者。 */
        id: SessionId
      }
    }
  }
}
