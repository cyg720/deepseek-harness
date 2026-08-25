/*
 * ================================ 文件注释 ================================
 * 【文件职责】提问域的 zod schema：问题答案与提问应答载荷的校验 schema，服务
 * 于 /api/respond 端点经 pending 表路由后的二次解析。问题标识即回显的 rpcId，
 * 载荷不携带资源 id。
 * 【技术维度】askUserQuestionAnswerSchema 严格对齐核心 dsh-user-questions 类型；
 * 载荷 schema 用 satisfies Wire<QuestionResponsePayload> 约束；sessionId 复用
 * sessions.schema 的铸造点。
 * 【产品维度】客户端对提问的应答在线上边界被严格校验（答案列表结构、选项 id、
 * 自定义文本可选），防止畸形应答进入核心。
 * 【逻辑维度】答案 schema（answers 数组）→ 应答载荷 schema（sessionId + answer）。
 * 【关键边界】answers 数组顺序与问题一一对应（实现层按索引比对，见
 * matchesQuestions）；custom 可选。
 * 【新手阅读建议】与 questions.ts 类型及 api-proxy.ts 的 matchesQuestions 对照。
 * ==========================================================================
 */
/**
 * questions domain zod schemas (respond is a client-response; the payload schema serves
 * the /api/respond endpoint's second parse after routing via the pending table). The question
 * identifier is the echoed rpcId; the payload carries no resource id.
 */

import { z } from 'zod'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/types'
import type { QuestionResponsePayload } from './questions.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'

/** AskUserQuestionAnswer validated strictly against core dsh-user-questions. */
// 严格对照核心 user-questions 的问题答案 schema：答案 id、选中项与可选自定义文本。
export const askUserQuestionAnswerSchema = z.object({
  answers: z.array(z.object({
    id: z.string(),
    selected: z.array(z.string()),
    custom: z.string().optional(),
  })),
}) satisfies z.ZodType<Wire<AskUserQuestionAnswer>>

/** Question answer payload (the result.value slot of a client-response). */
export const questionResponsePayloadSchema = z.object({
  sessionId: sessionIdSchema,
  answer: askUserQuestionAnswerSchema,
}) satisfies z.ZodType<Wire<QuestionResponsePayload>>
