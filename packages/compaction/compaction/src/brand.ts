/**
 * 文件职责：定义并构造一次压缩事务使用的不透明 CompactionId。
 * 技术维度：通过 TypeScript 品牌类型区分普通字符串与压缩事务身份。
 * 产品维度：开始、摘要、检查点和结束事件能可靠关联到同一次上下文压缩。
 * 逻辑维度：导出品牌类型，并提供只做类型转换的同名构造函数。
 * 关键边界：构造函数不校验唯一性或格式，调用方必须只传实现生成的标识。
 * 新手阅读建议：先理解品牌类型不改变运行时字符串，再追踪 ID 贯穿的事件。
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity shared by one compact start/summary/checkpoint/end transaction. */
/** 单次压缩事务共享的稳定身份类型；不能与其他领域的字符串 ID 混用。 */
export type CompactionId = Branded<'CompactionId'>

/**
 * Brand an implementation-minted compaction identity.
 * @param id - opaque transaction identity.
 * @returns the same string, branded; no validation is performed.
 */
/**
 * 把实现生成的字符串标记为压缩事务 ID。
 * @param id 不透明事务身份；格式不限，但调用方负责唯一性和来源可信。
 * @returns 原字符串的 CompactionId 品牌视图，不执行运行时校验。
 * @example `const id = CompactionId(crypto.randomUUID())`
 */
export function CompactionId(id: string): CompactionId {
  return id as CompactionId
}
