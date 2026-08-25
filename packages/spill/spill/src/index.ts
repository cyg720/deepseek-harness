/**
 * Service Definition for the spill storage capability seam (`ctx.spillStore`): an abstract service defining WHAT a
 * spill backend does — persist a tool's oversized text and return a model-facing
 * locator plus retrieval guidance — without saying HOW. Implementations
 * subclass {@link SpillStore} and register as the `spillStore` service;
 * `@deepseek-ai/dsh-spill-local` (host filesystem) is the first.
 *
 * The Service Definition is deliberately minimal: `saveText` and nothing else. It owns NO
 * retention policy (that is `@deepseek-ai/dsh-output-retention`), NO tool-result
 * replacement (that is `@deepseek-ai/dsh-spill-policy`), and NO retrieval or
 * search API. The backend supplies the locator and retrieval hint appropriate
 * for its storage substrate.
 *
 * @module @deepseek-ai/dsh-spill
 */
/*
 * 文件职责：实现 index.ts 覆盖的大结果落盘行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的大结果落盘能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SaveTextSpill, SpillRef } from './types.ts'

export { SpillLocator } from './types.ts'
export type { SaveTextSpill, SpillOwner, SpillRef, SpillSource } from './types.ts'

declare module '@deepseek-ai/cordis' {
  /** 中文说明：interface Context 定义本模块所需的数据或行为，用于表达大结果落盘场景。 */
  interface Context {
    spillStore: SpillStore
  }
}

/**
 * Abstract spill storage service. Subclass, implement {@link saveText}, and load
 * the subclass as a plugin — it registers as `ctx.spillStore` (one
 * implementation per context; loading a second throws, cordis' standard
 * duplicate-service behavior).
 *
 * Semantics every implementation must honor:
 * - {@link saveText} persists the FULL `content` verbatim and returns an opaque
 *   locator, exact byte length, and model-facing retrieval guidance.
 * - Storage is scoped by the request's {@link SaveTextSpill.owner} session; the
 *   backend chooses a private (not world-readable) location and a collision-free
 *   name derived from — never equal to — the caller's `suggestedName`.
 * - `saveText` REJECTS on a real storage failure (permissions, ENOSPC, backend
 *   unavailable); the caller decides how to degrade (the spill policy treats a
 *   rejection as best-effort and keeps the inline result).
 */
export abstract class SpillStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'spillStore')
  }

  /**
   * Persist `input.content` to a session-scoped spill artifact.
   * @param input - the owner, caller-supplied source fields, suggested name, and full text to save.
   * @returns the saved artifact's {@link SpillRef}; rejects on a storage failure.
   */
  abstract saveText(input: SaveTextSpill): Promise<SpillRef>
}

export default SpillStore
