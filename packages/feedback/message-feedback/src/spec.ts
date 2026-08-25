/**
 * Durable storage-domain declaration for lifecycle-bound message feedback.
 * @module @deepseek-ai/dsh-message-feedback/src/spec
 */
/*
 * 文件职责：实现反馈记录的 spec.ts 模块。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证反馈记录在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：注册服务或命令，转换请求并记录结果。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */

import { z } from 'zod'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MessageFeedbackItem, MessageFeedbackRating, MessageFeedbackVersion } from './types.ts'

/** 中文说明：模块局部值 nonNegativeSafeInteger，由紧邻初始化决定。 */
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for the closed rating vocabulary. */
/* 中文说明：模块局部值 解构结果，由紧邻初始化决定。 */
export const messageFeedbackRatingSchema = z.union([
  z.literal('positive'),
  z.literal('negative'),
]) satisfies z.ZodType<MessageFeedbackRating>

/** Runtime schema for one opaque item version stored on disk. */
/* 中文说明：模块局部值 解构结果，由紧邻初始化决定。 */
export const messageFeedbackVersionSchema = z.uuid()
  .transform(value => value as MessageFeedbackVersion)

/** Runtime schema for one current feedback item. */
// Zod infers transformed branded fields structurally, so it cannot name the
// public interface even though every branded output is created below.
/** 中文说明：模块局部值 messageFeedbackItemSchema，由紧邻初始化决定。 */
export const messageFeedbackItemSchema = z.object({
  messageId: z.string().min(1).transform(value => value as MessageId),
  rating: messageFeedbackRatingSchema,
  note: z.string().refine(note => note.trim().length > 0, {
    message: 'message feedback note must contain a non-whitespace character',
  }).optional(),
  version: messageFeedbackVersionSchema,
  createdAt: nonNegativeSafeInteger,
  updatedAt: nonNegativeSafeInteger,
}).refine(item => item.updatedAt >= item.createdAt, {
  path: ['updatedAt'],
  message: 'message feedback updatedAt must not precede createdAt',
}) as unknown as z.ZodType<MessageFeedbackItem>

/** Persisted Session fields that fence a sidecar row to one log lifecycle. */
/* 中文说明：模块局部值 解构结果，由紧邻初始化决定。 */
export const messageFeedbackSessionIdentitySchema = z.object({
  createdAt: nonNegativeSafeInteger,
  cwd: z.string().optional(),
})

/** Persisted lifecycle identity inferred from its durable schema. */
/* 中文说明：类型或类 MessageFeedbackSessionIdentity 约束扩展或反馈数据职责。 */
export type MessageFeedbackSessionIdentity = z.infer<typeof messageFeedbackSessionIdentitySchema>

/**
 * One whole-Session sidecar. Duplicate message ids would make item lookup
 * ambiguous; duplicate versions would break their independent identity.
 */
/* 中文说明：模块局部值 messageFeedbackRowSchema，由紧邻初始化决定。 */
export const messageFeedbackRowSchema = z.object({
  session: messageFeedbackSessionIdentitySchema,
  items: z.array(messageFeedbackItemSchema),
}).superRefine((row, ctx) => {
  /** 中文说明：模块局部值 messageIds，由紧邻初始化决定。 */
  const messageIds = new Set<string>()
  /** 中文说明：模块局部值 versions，由紧邻初始化决定。 */
  const versions = new Set<string>()
  row.items.forEach((item, index) => {
    if (messageIds.has(item.messageId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'messageId'],
        message: `duplicate message feedback id '${item.messageId}'`,
      })
    }
    messageIds.add(item.messageId)
    if (versions.has(item.version)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'version'],
        message: `duplicate message feedback version '${item.version}'`,
      })
    }
    versions.add(item.version)
  })
})

/** Durable sidecar row inferred from {@link messageFeedbackRowSchema}. */
/* 中文说明：类型或类 MessageFeedbackRow 约束扩展或反馈数据职责。 */
export type MessageFeedbackRow = z.infer<typeof messageFeedbackRowSchema>

/** One lifecycle-bound sidecar record per Session id. */
/* 中文说明：模块局部值 messageFeedbackDomainSpec，由紧邻初始化决定。 */
export const messageFeedbackDomainSpec = defineDomain({
  name: 'message_feedback',
  version: 0,
  tables: {
    sessions: domainTable<SessionId, MessageFeedbackRow>(messageFeedbackRowSchema),
  },
})
