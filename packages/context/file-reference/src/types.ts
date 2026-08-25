/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义文件引用发现（file-reference）能力的公开数据记录。本模块只含
 *             类型定义、没有任何运行时代码，因此生成的 Remote 客户端（如 Web 端）
 *             可以不依赖 Host 端运行时逻辑直接消费这些类型。
 * 【技术维度】纯 TypeScript 类型模块，通过 Typert 协议在终端/Web 客户端与 Host
 *             之间传递"文件补全候选"数据。
 * 【产品维度】用户在编辑器输入 @ 触发文件补全时，候选文件/目录的展示数据。
 * 【逻辑维度】仅一个接口 FileReferenceCandidate，含两个字段：path（用户可见路径）
 *             与 kind（文件或目录）。
 * 【关键边界】本模块只描述"一个候选"的数据形态，不含获取候选的发现逻辑；路径
 *             能否被编辑器语法安全表示，由 grammar.ts 判定。
 * 【新手阅读建议】先读本文件了解候选数据结构，再读 grammar.ts 了解 @ 语法解析，
 *                 最后读 index.ts 了解服务总入口。
 * ==========================================================================
 */

/**
 * Public file-reference discovery records. This module contains types only so
 * generated Remote clients can consume it without Host runtime code.
 * @module @deepseek-ai/dsh-file-reference/types
 */

/** One path-only completion candidate inside the target session cwd. */
/* 一个路径补全候选：只包含路径本身，不带文件内容或任何元数据。 */
export interface FileReferenceCandidate {
  /** User-facing path accepted by normal prompts and filesystem tools. */
  /* 用户可见的路径，可直接用于提示词或文件系统工具（如 read 工具）。 */
  path: string
  /** Directories keep completion open; files finish the mention. */
  /* 目录会保持补全继续展开（其后可再输入子路径），文件则结束本次提及。 */
  kind: 'file' | 'directory'
}
