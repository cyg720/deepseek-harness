/**
 * 无会话发送的确定性流程（纯逻辑部分，便于单测）。
 *
 * 已确认的源码事实：无当前会话时 session 贡献的 hooks/keyedHooks/props **全部为
 * undefined**（含 `inputActions`），`session-maybe` 只让界面存在；公开
 * `inputActions.submit()` 固定执行 `submit('queue')`，所以运行中提交＝排队。
 *
 * 因此无会话发送必须先建会话并等 binding 就绪：
 * `create → open → 等 session-maybe 重新物化 → setDraft → submit`。
 * `opId` 只由本地编排器持有，不传给官方接口；预分配的 sessionId 必须**跨页面唯一**，
 * 页面内递增序号会在刷新/多标签页下重复。
 */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/** 一次本地提交的编排状态。 */
export interface SubmitOperation {
  /** 本地操作代次；用于隔离迟到回调（官方没有远端幂等）。 */
  readonly opId: string
  /** 点击时冻结的文本。 */
  readonly text: string
  /** 预分配的会话 id（无会话路径才有）。 */
  readonly requestedSessionId?: string
}

/** 生成一个本地操作代次。
 * @param sequence - 当前页面的操作序号。
 * @returns 操作标识。
 */
export function nextOpId(sequence: number): string {
  return `qs-op-${sequence}`
}

/**
 * 生成跨页面唯一的预分配会话 id。
 *
 * 页面内递增序号在刷新与多标签页下会重复，不能作为幂等恢复的键。
 * @returns 唯一 id。
 */
export function newRequestedSessionId(): string {
  // 走仓库的 util-crypto：浏览器在明文 HTTP 的局域网页面里会扣留 crypto.randomUUID，
  // 那种部署下直接用 WebCrypto 会拿不到 id。
  return `qs-${randomUUID()}`
}

/**
 * 判断一次异步回调是否仍然有效。
 *
 * 取消、切换会话或登出都会使操作失效；即使随后回到同一会话，也不得恢复旧操作。
 * @param current - 当前有效的操作代次；undefined 表示没有在途操作。
 * @param opId - 回调携带的操作代次。
 * @returns 仍然有效时为 true。
 */
export function isOperationCurrent(current: string | undefined, opId: string): boolean {
  return current === opId
}

/**
 * 判定提交前缀是否为空（空输入禁用发送；附件占位不计入）。
 * @param text - 草稿文本。
 * @returns 去空白后为空时为 true。
 */
export function isBlankSubmission(text: string): boolean {
  return text.trim() === ''
}

/**
 * 判断本次按键是否应当提交。
 *
 * Enter 提交、Shift+Enter 换行；**IME 组合期不提交**（组合中的 Enter 只确认候选）。
 * @param input - 按键信息。
 * @returns 应当提交时为 true。
 */
export function shouldSubmitOnEnter(input: {
  readonly key: string
  readonly shiftKey: boolean
  readonly isComposing: boolean
}): boolean {
  if (input.isComposing) return false
  return input.key === 'Enter' && !input.shiftKey
}

/**
 * 判断无会话路径的交接是否已经就绪。
 *
 * 三个条件同时成立才落 `setDraft` + `submit`：请求的会话已成为当前会话、
 * 输入动作已物化、本次操作仍然有效。缺任何一条都不能投递。
 * @param input - 当前编排与绑定状态。
 * @returns 可以交接时为 true。
 */
export function isHandoffReady(input: {
  readonly pendingOpId: string | undefined
  readonly currentOpId: string | undefined
  readonly requestedSessionId: string
  readonly currentSessionId: string | undefined
  readonly hasInputActions: boolean
}): boolean {
  if (input.pendingOpId === undefined || input.currentOpId === undefined) return false
  if (input.pendingOpId !== input.currentOpId) return false
  if (!input.hasInputActions) return false
  return input.currentSessionId === input.requestedSessionId
}

/** 队列条目视图模型。 */
export interface QueueRowView {
  /** 队列项 id，逐行操作用它定位。 */
  readonly id: string
  /** 预览文本。 */
  readonly text: string
  /** 落点：排队 / 引导当前轮。 */
  readonly placement: string
  /** Mixed-content messages cannot be replaced by text-only queue edits. */
  readonly editable: boolean
}

/** 官方的队列行：只取本模块要用的字段。 */
interface QueueRowLike {
  readonly id: unknown
  readonly preview?: string
  readonly text?: string | null
  readonly placement: string
}

/**
 * 把官方队列投影成视图模型。
 *
 * 只读快照，不在本地维护第二套待发队列（见 06-槽位与状态设计 第十二节）。
 * @param queue - 会话快照里的队列。
 * @returns 队列行。
 */
export function queueRows(queue: readonly QueueRowLike[]): readonly QueueRowView[] {
  return queue.map(item => ({
    id: String(item.id),
    text: item.text ?? item.preview ?? '',
    placement: item.placement,
    editable: item.text != null,
  }))
}
