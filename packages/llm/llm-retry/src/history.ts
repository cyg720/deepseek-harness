/*
 * ================================ 文件注释 ================================
 * 【文件职责】为"当前打开的模型步骤"查找生效中的 provider 路由（从会话事件
 * 历史里读取最近的请求头）。
 * 【技术维度】纯查询函数：在事件数组里定位 step/start，向前扫描最近的
 * request/header 事件取 provider；请求头在轮次边界间持续生效，直到更新的
 * 完整快照改变它（任何 provider 变更都必须伴随新的完整快照）。
 * 【产品维度】重试不变量校验需要确认"调度重试的 provider 就是失败请求的
 * provider"；该查询把"哪个 provider 在哪个步骤生效"变成可校验的事实。
 * 【逻辑维度】定位 step/start → 校验步骤仍打开 → 向前找最近的请求头 → 返回
 * provider（无则 undefined）。
 * 【关键边界】步骤已结束/轮次已结束时返回 undefined；这里用了非空断言
 * （oxlint 已豁免），其依据是循环边界保证索引读取必然存在。
 * 【新手阅读建议】先理解"请求头跨轮次持续生效"的模型，再看向前扫描循环。
 * ==========================================================================
 */

/** Durable request-route lookup for one open model step. @module @deepseek-ai/dsh-llm-retry/history */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/*
 * （中文）找出当前打开步骤生效中的 provider。
 * 请求头在轮次边界间持续生效，直到更新的完整快照改变它；每次 provider 变更
 * 都必须有更新的完整快照。
 * @param events 结束于打开步骤内的会话事件。
 * @param turn 拥有失败步骤的轮次。
 * @param step 需要 provider 的失败步骤。
 * @returns 该步骤生效的请求头里的 provider。
 */
/**
 * Find the provider in force for one currently open step.
 * Request headers remain effective across turn boundaries until a newer full
 * snapshot changes them; every provider change requires a newer full snapshot.
 * @param events - session events ending inside the open step.
 * @param turn - turn that owns the failed step.
 * @param step - failed step whose provider is required.
 * @returns the provider from the request header in force for the step.
 */
export function providerForOpenStep(
  events: readonly SessionEvent[],
  turn: number,
  step: number,
): string | undefined {
  // 中文：定位该 turn/step 的 step/start（必须存在且之后没有 step/end 或
  // turn/end，即步骤仍打开）。
  const stepStartIndex = events.findLastIndex(event =>
    event.type === 'step/start'
    && event.data.turn === turn
    && event.data.step === step,
  )
  if (stepStartIndex < 0 || events.slice(stepStartIndex + 1).some(event =>
    event.type === 'step/end' || event.type === 'turn/end')) return undefined
  // 中文：从最新事件向前扫描，取最近一条 request/header 的 provider。
  for (let index = events.length - 1; index >= 0; index -= 1) {
    // The loop bounds prove this indexed read exists.
    // 中文：循环边界保证该索引读取必然存在。
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = events[index]!
    if (event.type === 'request/header') return event.data.header.config.provider
  }
  return undefined
}
