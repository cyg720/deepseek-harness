/*
 * ================================ 文件注释 ================================
 * 【文件职责】file-reference 能力缝（capability seam）的对外总入口：定义
 *             FileReferenceService 抽象服务（Host 端能力），供终端/Web 界面
 *             发起可取消的文件补全发现请求。
 * 【技术维度】基于 Cordis 的 TypertRemoteService 远程服务：抽象方法 list 在
 *             Host 实现，remoteExportList 通过 @Remote 装饰器暴露为远程调用面；
 *             同时导出与语法相关的工具函数（activeAtToken/formatFileMention）。
 * 【产品维度】用户在编辑器里输入 @ 触发文件补全、上下移动选择候选的体验背后，
 *             就是这个服务在按关键字实时列出候选文件/目录。
 * 【逻辑维度】1) 重导出语法工具与候选类型；2) 导出提示词常量 FILE_REFERENCE_PROMPT；
 *             3) 声明 Context 上的 fileReferences 服务挂载点；4) 定义抽象服务类
 *             （list 抽象方法 + remoteExportList 远程适配方法）。
 * 【关键边界】本文件只定义缝（接口与注册），具体文件系统实现由 Host 侧插件提供；
 *             取消通过 AbortSignal 传递，候选结果保证确定性（按同一输入返回同一序列）。
 * 【新手阅读建议】先看 FILE_REFERENCE_PROMPT（模型侧如何理解 @ 引用），再看
 *                 FileReferenceService 的两个方法及其远程化方式。
 * ==========================================================================
 */

/**
 * File-reference discovery seam shared by host-backed user interfaces.
 *
 * @module @deepseek-ai/dsh-file-reference
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

import type { FileReferenceCandidate } from './types.ts'

export { activeAtToken, formatFileMention } from './grammar.ts'
export type { ActiveAtToken } from './grammar.ts'
export type { FileReferenceCandidate } from './types.ts'

/** Model guidance for path-only references selected by a user interface. */
export const FILE_REFERENCE_PROMPT = 'Tokens prefixed with @ are workspace paths the user explicitly referenced, relative to the workspace root. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.'

/** 声明 Cordis Context 上的服务挂载点：其他插件可通过 ctx.fileReferences 访问本服务。 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    fileReferences: FileReferenceService
  }
}

/** Host capability for cancellable file-reference discovery. */
export abstract class FileReferenceService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'fileReferences')
  }

  /**
   * List file and directory candidates for one agent's working directory.
   * @param agent - target agent whose session cwd bounds discovery.
   * @param query - path text following `@` or `@"`.
   * @param signal - caller cancellation.
   * @returns deterministic path-only candidates.
   */
  /*
   * 列出某个 agent 工作目录下的文件/目录补全候选。
   * @param agent 目标 agent，其会话 cwd 决定了发现范围
   * @param query @ 或 @" 之后的路径文本（补全关键字）
   * @param signal 调用方的取消信号（用户关闭补全面板时中止请求）
   * @returns 确定性的路径候选列表（不含文件内容，仅路径与类型）
   */
  abstract list(
    agent: Agent,
    query: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]>
}

export default FileReferenceService
