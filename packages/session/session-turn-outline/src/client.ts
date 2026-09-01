/*
 * 中文导读：本模块向客户端命名空间重导出轮次大纲类型，保持 Host 与 Client 共用唯一类型来源。
 */

/**
 * Client-namespace projection of the turn-outline domain: a pure re-export
 * of the package's types outlet. Client code imports ONLY the client
 * namespace (repo discipline), so `./client` projects the same single-source
 * content `./types` serves to host consumers — zero duplication.
 *
 * @module @deepseek-ai/dsh-session-turn-outline/client
 */

export type * from './types.ts'
