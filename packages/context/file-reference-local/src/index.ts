/*
 * ================================ 文件注释 ================================
 * 【文件职责】ctx.fileReferences 服务的本地文件系统实现：在 Host 进程中扫描
 *             agent 的工作目录，为 @ 文件补全提供候选。这是 file-reference
 *             能力缝（Service Definition）在本地的具体 Provider。
 * 【技术维度】继承 FileReferenceService（远程服务基类），内部用 WorkspaceFileSearch
 *             维护每个 agent 的模糊搜索索引；通过 schemastary 校验配置；
 *             在 agent 生命周期事件与工具结果事件上做索引的建立/失效/销毁。
 * 【产品维度】用户在终端/Web 编辑器输入 @ 时弹出的文件补全列表，就是本服务
 *             实时扫盘并排序的结果。
 * 【逻辑维度】1) 定义可配置项 Config（结果数/索引条目数/排除目录）；2) 服务类
 *             为每个 agent 懒创建搜索索引；3) 注入系统提示词（仅当 read 工具
 *             存在时）；4) 监听 agent/created、agent/disposed、session/event
 *             维护索引与提示词的生命周期。
 * 【关键边界】索引只含路径不含内容，文件内容仍由模型侧的 read 工具读取；
 *             工具结果事件触发索引失效，保证补全反映最新文件树。
 * 【新手阅读建议】先看 Config 与类成员变量，再看构造函数里的生命周期接线，
 *                 最后看 list 的懒加载逻辑与 search.ts 中的实际扫描实现。
 * ==========================================================================
 */

/**
 * Local-filesystem implementation of `ctx.fileReferences`.
 *
 * @module @deepseek-ai/dsh-file-reference-local
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import FileReferenceService, {
  FILE_REFERENCE_PROMPT,
  type FileReferenceCandidate,
} from '@deepseek-ai/dsh-file-reference'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  WorkspaceFileSearch,
  type FileSearchConfig,
} from './search.ts'

export {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  WorkspaceFileSearch,
} from './search.ts'
export type { FileSearchConfig } from './search.ts'
export { FILE_REFERENCE_PROMPT } from '@deepseek-ai/dsh-file-reference'
export { activeAtToken, formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'

/** Local file-reference discovery configuration. */
/* 本地文件引用发现的配置：均可由用户通过 cordis.yml 覆盖，未配置时用默认值。 */
export interface Config {
  /** Maximum ranked candidates returned for one query. */
  /* 单次查询最多返回的候选数（排序后截断）。 */
  maxResults?: number
  /** Maximum indexed files and directories per agent workspace. */
  /* 每个 agent 工作区最多纳入索引的文件与目录总数（防止大仓库扫爆内存）。 */
  maxEntries?: number
  /** Directory basenames never traversed or offered. */
  /* 永不遍历/永不展示的目录名（如 .git、node_modules），只匹配 basename。 */
  excludedDirectories?: string[]
}

/** Local-filesystem owner of the file-reference discovery service. */
/* 本地文件系统实现：拥有并管理每个 agent 的搜索索引与提示词注入生命周期。 */
export class LocalFileReferenceService extends FileReferenceService {
  /** Cordis 依赖注入：需要 agents 服务（遍历/订阅 agent 生命周期）。 */
  static inject = ['agents']
  /** 配置校验模式：schemastary 负责解析 cordis.yml 传入的配置并填充默认值。 */
  static Config: z<Config> = z.object({
    maxResults: z.number().step(1).min(1).default(DEFAULT_FILE_SEARCH_MAX_RESULTS),
    maxEntries: z.number().step(1).min(1).default(DEFAULT_FILE_SEARCH_MAX_ENTRIES),
    excludedDirectories: z.array(z.string()).default([...DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES]),
  })

  /** 解析并校验后的生效配置（构造函数里完成默认值合并）。 */
  private readonly config: FileSearchConfig
  /** 每个 agent 一个搜索索引；懒创建，agent 销毁或工具结果事件触发失效。 */
  private readonly searches = new Map<Agent, WorkspaceFileSearch>()
  /** 每个 agent 一个提示词注入 fiber（Cordis 的局部作用域，可整体卸载）。 */
  private readonly promptFibers = new Map<Agent, ReturnType<Context['inject']>>()
  /** 已进入销毁流程的 fiber 注销任务集合，用于统一等待清理完成。 */
  private readonly promptDisposals = new Set<Promise<void>>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.config = {
      maxResults: config.maxResults ?? DEFAULT_FILE_SEARCH_MAX_RESULTS,
      maxEntries: config.maxEntries ?? DEFAULT_FILE_SEARCH_MAX_ENTRIES,
      excludedDirectories: config.excludedDirectories ?? DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
    }
    validateConfig(this.config)

    // 为单个 agent 注入系统提示词段：仅当该 agent 可用 read 工具时展示 @ 引用说明
    const installPrompt = (agent: Agent): void => {
      if (this.promptFibers.has(agent)) return
      const fiber = agent.ctx.inject(['systemPrompt', 'tools'], (scope) => {
        scope.systemPrompt.section({
          name: 'context:file-reference',
          order: FIRST_PARTY_SECTION_ORDER.FILE_REFERENCE,
          text: () => agent.ctx.tools.get('read', agent) === undefined ? '' : FILE_REFERENCE_PROMPT,
        })
      })
      this.promptFibers.set(agent, fiber)
    }
    // 卸载单个 agent 的提示词 fiber，并把注销任务收进集合以便统一 await
    const disposePrompt = (agent: Agent): void => {
      const fiber = this.promptFibers.get(agent)
      if (fiber === undefined) return
      this.promptFibers.delete(agent)
      const task = fiber.dispose().catch((error: unknown) => {
        ctx.logger.warn(`file-reference-local: prompt cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      this.promptDisposals.add(task)
      void task.finally(() => {
        this.promptDisposals.delete(task)
      })
    }
    // 为当前已存在的每个 agent 立即注入提示词
    for (const agent of ctx.agents.list()) installPrompt(agent)
    // agent 创建时注入提示词
    ctx.on('agent/created', ({ agent }) => { installPrompt(agent) })
    // agent 销毁时清理其搜索索引与提示词
    ctx.on('agent/disposed', ({ agent }) => {
      this.searches.get(agent)?.dispose()
      this.searches.delete(agent)
      disposePrompt(agent)
    })
    // 工具结果事件：任何工具执行完成都可能改变文件树，失效对应 agent 的索引
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'tool/result') return
      const agent = ctx.agents.get(session.id)
      if (agent !== undefined) this.searches.get(agent)?.invalidate()
    })
    // 服务卸载时回收所有索引与提示词 fiber
    ctx.effect(() => async () => {
      for (const search of this.searches.values()) search.dispose()
      this.searches.clear()
      const promptFibers = [...this.promptFibers.values()]
      this.promptFibers.clear()
      await Promise.all([
        ...promptFibers.map(fiber => fiber.dispose()),
        ...this.promptDisposals,
      ])
    }, 'file-reference-local: search cache')
  }

  /**
   * 返回某个 agent 工作目录下的补全候选：懒创建该 agent 的搜索索引后转交查询。
   * @param agent 目标 agent，其会话 cwd（无则进程 cwd）为索引根目录
   * @param query @ 或 @" 之后的路径文本
   * @param signal 调用方取消信号
   * @returns 按相关度排序的候选列表
   */
  override list(
    agent: Agent,
    query: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]> {
    let search = this.searches.get(agent)
    if (search === undefined) {
      search = new WorkspaceFileSearch(agent.session.header.cwd ?? process.cwd(), this.config)
      this.searches.set(agent, search)
    }
    return search.list(query, signal)
  }
}

/**
 * 校验配置合法性：三个字段都必须为正的安全整数，排除目录必须是
 * 不含路径分隔符的非空 basename（防止误伤深层路径）。
 * @param config 构造函数合并后的生效配置
 */
function validateConfig(config: FileSearchConfig): void {
  if (!Number.isSafeInteger(config.maxResults) || config.maxResults <= 0) {
    throw new Error('file-reference-local: maxResults must be a positive safe integer')
  }
  if (!Number.isSafeInteger(config.maxEntries) || config.maxEntries <= 0) {
    throw new Error('file-reference-local: maxEntries must be a positive safe integer')
  }
  if (config.excludedDirectories.some(name => name.length === 0 || name.includes('/') || name.includes('\\'))) {
    throw new Error('file-reference-local: excludedDirectories entries must be non-empty directory basenames')
  }
}

export default LocalFileReferenceService
