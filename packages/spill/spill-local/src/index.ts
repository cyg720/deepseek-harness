/**
 * `LocalSpillStore`: the host-filesystem implementation of the
 * `@deepseek-ai/dsh-spill` storage seam. Persists a tool's oversized text to a
 * private, session-scoped file (see `./store.ts` for the traversal-safe naming
 * and exclusive owner-only write) and returns a path locator plus local
 * read/grep retrieval guidance.
 *
 * @module @deepseek-ai/dsh-spill-local
 */
/*
 * 文件职责：实现将过大工具文本安全写入本机文件系统的 SpillStore 提供方。
 * 技术维度：使用 Cordis 服务、Schemastery 配置、路径解析和安全文件写入辅助函数。
 * 产品维度：模型上下文放不下完整工具输出时，用户仍可通过文件路径分段读取或搜索内容。
 * 逻辑维度：解析存储根目录，把文本交给安全写入函数，再返回带字节数和读取提示的定位器。
 * 关键边界：默认目录与文件仅限所有者访问；调用方不可把返回路径视为跨机器可用的地址。
 * 新手阅读建议：先看 Config 和构造函数如何确定根目录，再追踪 saveText 到 store.ts 的安全写入。
 */

import { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { SpillLocator, SpillStore } from '@deepseek-ai/dsh-spill'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'
import { privateRoot, saveTextFile } from './store.ts'

export { encodeSegment, privateRoot, saveTextFile, sessionDir } from './store.ts'
export type { SavedText, SaveTextOptions } from './store.ts'

/** Plugin config (all optional — `static Config` supplies the defaults). */
/* 插件配置；字段均可省略，静态 Config 负责声明默认解析规则。 */
export interface Config {
  /**
   * Root directory for spill files. Omitted uses a lazily-created private
   * (0700) per-process directory under the OS temp dir — the safe default for
   * a local deployment. Set it to keep spill files under a known location.
   */
  /* 溢出文件根目录；省略时使用进程专属、权限受限的临时目录。 */
  root?: string
}

/**
 * Local-filesystem spill backend. Files land under `<root>/session-<hash>/…`
 * with unpredictable names, an exclusive owner-only (0600) write, and a private
 * (0700) root — a spilled tool result must not be readable by other local users
 * or redirectable via a planted symlink.
 */
/*
 * 本地文件系统 SpillStore，将文本保存到会话隔离目录并返回本地路径。
 * 适用于单机部署中需要保存过大工具结果的场景。
 */
export class LocalSpillStore extends SpillStore {
  /** Schemastery 配置定义，允许调用方提供存储根目录。 */
  static Config: z<Config> = z.object({
    root: z.string(),
  })

  /** Resolved absolute spill root (config `root`, else the private default), fixed at construction. */
  /* 构造时确定的绝对存储根目录，之后保持不变。 */
  readonly root: string

  /**
   * 创建本地溢出存储服务并解析固定根目录。
   * @param ctx 承载该服务的 Cordis 上下文。
   * @param config 可选的本地存储配置。
   * @example `new LocalSpillStore(ctx, { root: './spill' })`
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.root = config.root !== undefined ? resolve(config.root) : privateRoot()
  }

  /**
   * 安全保存一段过大文本并生成可供工具响应引用的定位信息。
   * @param input 文本内容、所有者会话和建议文件名。
   * @returns 文件定位器、实际字节数与本地读取提示。
   * @example `await store.saveText({ owner, content, suggestedName: 'output.txt' })`
   */
  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    /** 安全写入函数返回的绝对路径和 UTF-8 字节数。 */
    const saved = await saveTextFile({
      root: this.root,
      sessionId: input.owner.sessionId,
      suggestedName: input.suggestedName,
      content: input.content,
    })
    return {
      locator: SpillLocator(saved.path),
      bytes: saved.bytes,
      retrievalHint: 'Use read with offset/limit, or grep this path to search within it.',
    }
  }
}

/** Cordis 默认导出，允许配置文件直接加载本地溢出存储类。 */
export default LocalSpillStore
