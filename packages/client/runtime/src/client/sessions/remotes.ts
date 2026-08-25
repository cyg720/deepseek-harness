/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义会话（Session）及其管理器通过远程层（Remote）调用的
 *   命名空间类型：客户端 Cordis 运行时与 Host 之间的调用面。
 * 【技术维度】类型层面的"面"（surface）约束：从 Context['remote'] 中
 *   挑出 'commands' 这一命名空间，声明式描述可用的远程命令。
 * 【产品维度】客户端只关心会话命令这类与产品流程直接相关的远程能力，
 *   类型约束防止误用无关的远程命名空间。
 * 【逻辑维度】无运行时代码，仅导出类型别名 SessionRemotes。
 * 【关键边界】Pick 出的键必须真实存在于 Context['remote']，
 *   否则类型编译报错；本文件是纯类型模块，运行时为空。
 * 【新手阅读建议】理解"Context.remote 是生成的自描述远程面"即可，
 *   具体命令实现在 @deepseek-ai/dsh-api-remotes 包中生成。
 * ==========================================================================
 */
/**
 * Remote namespaces the Session cluster calls. One parameter for one concept:
 * the generated surface a Session and its manager reach the Host through.
 *
 * @module @deepseek-ai/dsh-client-runtime/client/sessions/remotes
 */
/*
 * 会话集群（Session 与它的管理器）调用的远程命名空间：每个参数只对应一个
 * 概念，即会话及其管理器到达 Host 时使用的生成式调用面。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'

/** The generated Remote namespaces a Session and its manager call. */
/* 会话及其管理器调用的生成式远程命名空间：仅包含 'commands'（命令分发）。 */
export type SessionRemotes = Pick<Context['remote'], 'commands'>
