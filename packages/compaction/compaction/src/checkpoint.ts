/**
 * Compaction checkpoint provenance: the correlated source constructor and type
 * every backend uses for its replacement user message, plus the predicate that
 * recognizes persisted checkpoints.
 *
 * The seam itself lives in `@deepseek-ai/dsh-compaction`, which re-exports these
 * contracts; this module is a pure type/value/predicate outlet (no cordis
 * imports, no module augmentation) so client and wire programs can name the
 * checkpoint source without loading the host plugin's Context merges — the
 * `dsh-commands/brand` shape.
 *
 * @module @deepseek-ai/dsh-compaction/checkpoint
 */
/*
 * 中文说明：
 * - 文件职责：定义压缩检查点消息的统一来源标记、关联类型、构造函数和识别谓词。
 * - 技术维度：使用 TypeScript 交叉类型、品牌标识、条件对象展开和 Object.freeze 不可变值。
 * - 产品维度：让不同压缩后端生成的摘要消息可被会话恢复、客户端和传输层一致识别。
 * - 逻辑维度：固定 plugin 标记，附加压缩事务及可选命令标识，并通过来源字段判断持久消息。
 * - 关键边界：谓词只识别 kind/plugin 标记，不验证 compactionId；本模块不装载 Host 或 Cordis。
 * - 新手阅读建议：先看固定 MARKER，再理解类型如何增加关联字段，最后比较构造与识别函数的严格度。
 */

import type { MessageSource } from '@deepseek-ai/dsh-llm/message'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { CompactionId } from './brand.ts'

/** 压缩检查点共享的冻结来源标记；所有后端都必须使用 plugin=compact。 */
const COMPACT_CHECKPOINT_MARKER = Object.freeze({ kind: 'plugin', plugin: 'compact' } as const)

/** Message provenance carried by a concrete compaction checkpoint. */
/* 中文：具体压缩检查点携带的消息来源，包含固定标记、事务标识和可选的手动命令标识。 */
export type CompactionCheckpointSource = typeof COMPACT_CHECKPOINT_MARKER & {
  /** 拥有该检查点的压缩事务品牌标识。 */
  readonly compactionId: CompactionId
  /** 发起本次压缩的手动命令标识；自动压缩时省略。 */
  readonly sourceCommandId?: CommandId
}

/**
 * Create checkpoint provenance correlated with one compaction transaction.
 * @param compactionId - owning compaction identity.
 * @param sourceCommandId - initiating manual command, when present.
 * @returns immutable checkpoint source.
 */
/*
 * 中文：创建冻结的检查点来源；compactionId 必填，sourceCommandId 仅手动命令存在时传入，返回不可变来源对象。
 * @param compactionId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param sourceCommandId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function compactCheckpointSource(
  compactionId: CompactionId,
  sourceCommandId?: CommandId,
): CompactionCheckpointSource {
  return Object.freeze({
    ...COMPACT_CHECKPOINT_MARKER,
    compactionId,
    ...sourceCommandId === undefined ? {} : { sourceCommandId },
  })
}

/**
 * Test whether a persisted message source identifies a compaction checkpoint.
 * @param source - source restored from a surface user message.
 * @returns whether the source carries the backend-independent checkpoint marker.
 */
/*
 * 中文：判断持久消息来源是否带有统一 compact 插件标记；参数为 MessageSource，返回布尔值。示例：isCompactCheckpointSource(message.source)。
 * @param source 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function isCompactCheckpointSource(source: MessageSource): boolean {
  return source.kind === 'plugin' && source.plugin === COMPACT_CHECKPOINT_MARKER.plugin
}
