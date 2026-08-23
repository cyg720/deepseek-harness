/**
 * ================================ 文件注释 ================================
 * 【文件职责】提问域契约：定义提问应答载荷 QuestionResponsePayload。提问
 * requested 帧是 server-request，其 rpcId 即问题的稳定逻辑 id（宿主接受 ask()
 * 时铸造；核心 user-questions 没有请求级 id）；答案是回显该 rpcId 的
 * client-response，载荷中不再携带资源 id（rpcId 已足够）。
 * 【技术维度】纯类型契约；AskUserQuestionAnswer 直接复用核心 dsh-user-questions
 * 类型，不在此重新定义。
 * 【产品维度】多选/单选问题（如技能配置、操作确认）在宿主 GUI 中呈现，用户
 * 一次性回答整批问题（core 语义：一次 ask、多个问题、一份答案，绝不分问题拆）。
 * 【逻辑维度】QuestionResponsePayload：sessionId + answer（整批答案）。
 * 【关键边界】rpcId 是唯一关联键，载荷不携带资源 id；答案按"一次 ask 一批"的
 * 语义整体提交。
 * 【新手阅读建议】与 questions.schema.ts 及 api-proxy.ts 的 matchesQuestions
 * 校验逻辑对照阅读。
 * ==========================================================================
 */
/**
 * questions domain contract. The question requested frame is a
 * server-request whose rpcId is the question's stable logical id (minted when the host accepts
 * ask(); core user-questions has no request-level id); the answer is a client-response
 * echoing that rpcId, with no resource id in the payload (rpcId suffices).
 */

import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Question answer payload (the result.value slot of a client-response):
 * answers one ask() as a whole batch (core: one ask, many questions, one
 * answer — never split per question).
 */
// 提问应答载荷：整体回答一次 ask()（一次 ask、多问题、一份答案）。
export interface QuestionResponsePayload {
  sessionId: SessionId
  answer: AskUserQuestionAnswer
}
