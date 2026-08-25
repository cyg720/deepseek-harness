/*
 * ================================ 文件注释 ================================
 * 【文件职责】浏览器侧"动态 Cordis 词汇表"桶文件：把 Remote 装配里可用的类型
 *             （ID/库存行/请求与事件负载）原样再导出，供本包浏览器代码统一引用。
 * 【技术维度】纯类型再导出（export type）；@deepseek-ai/dsh-api-remotes/client
 *             的类型导入用于把 ctx.remote 与转发事件键集合并进本程序（side-effect
 *             类型合并，运行时无产物）。
 * 【产品维度】让 UI 代码与 Host 侧共享同一套跨端类型，避免重复定义与漂移。
 * 【逻辑维度】类型合并导入 → 一组类型再导出。
 * 【关键边界】只导出类型，不导出运行时值；新增事件类型需同步 Host 侧。
 * 【新手阅读建议】浏览导出清单即可，无需深究实现。
 * ==========================================================================
 */

/** Client-safe dynamic Cordis vocabulary re-exported through the Remote assembly. */

// Type-only: merges `ctx.remote` and the forwarded-event key set into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'

export type {
  ApprovalRequestId,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  DynamicCordisInventoryRow,
  DynamicCordisPackage,
  DynamicCordisRequestResolved,
  DynamicCordisRetracted,
  DynamicCordisRunRequest,
} from '@deepseek-ai/dsh-api-remotes/client'
