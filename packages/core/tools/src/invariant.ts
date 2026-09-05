

/** Package-owned tool-pipeline invariants. @module @deepseek-ai/dsh-tools/invariant */

/*
 * 【文件职责】检查工具流水线产生的持久调用与结果关系，约束执行过程的日志完整性。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ToolExecution, ToolExecutionResult } from './index.ts'

/**
 * 【中文】本包在不变量服务中的登记名：一个包只占一个名额，防止重复注册伴随插件。
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-tools'

/** Cordis companion plugin name. */
/* 【中文】Cordis 函数式插件约定导出的插件名。 */
export const name = 'tools-invariant'
/** Service required before the companion can reserve package ownership. */
/* 【中文】依赖声明：必须先加载 invariants 服务才能登记包所有权。 */
export const inject = ['invariants']

/**
 * 【中文】工具流水线阶段标记：pre（预执行闸门）→ execute(环绕分发) → post（后置策略），
 *   用于断言同一执行对象的阶段推进严格单调、不可跳跃或重复。
 */
type ToolStage = 'pre' | 'execute' | 'post'

/** Validate the immutable final execution/result snapshot. */
/*
 * 【中文】校验发布到 tools/result 观察者的最终快照：执行对象必须已冻结；结果对象
 *   及其 content 数组必须冻结；name 与 callId 必须非空。这是"观察者拿到的是不可变
 *   只读视图"这一承诺的可执行版本。
 */
function validateResult(
  exec: Readonly<ToolExecution>,
  result: Readonly<ToolExecutionResult>,
  fail: InvariantFailure,
): void {
  if (!Object.isFrozen(exec)) fail('tools/result execution must be frozen before publication')
  if (!Object.isFrozen(result) || !Object.isFrozen(result.content)) {
    fail('tools/result outcome and content must be frozen before publication')
  }
  if (exec.name.length === 0 || String(exec.callId).length === 0) {
    fail('tools/result execution must carry non-empty name and callId')
  }
}

/** Install monotonic pipeline, final-snapshot, and code-dispatch enclosure checks. */
/*
 * 【中文】安装三类不变量检查：① 流水线单调——同一执行的 pre → execute → post 严格
 *   依次发生且各一次，tools/result 后清除标记；② 最终快照——发布前必须冻结且标识
 *   非空（见 validateResult）；③ code-dispatch 封闭关系——三元 id 非空、subCallId 的
 *   根归属稳定、parent 属于该根、且必须发生在某个开启的 turn 内。启动时先对全部
 *   存量会话做历史回放建立基线，之后靠实时事件流增量维护。注意 install 通过
 *   Object.assign 附加了 `inject: ['sessions']`——它还需要会话服务来枚举存量会话。
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // 【中文】执行对象 → 当前所处阶段；WeakMap 键随执行对象被垃圾回收而自动清理。
  const stages = new WeakMap<object, ToolStage>()
  // 【中文】session → 当前开启的回合号（null 表示不在任何 turn 内），避免重复重放历史。
  const openTurns = new WeakMap<Session, number | null>()
  // 【中文】session → (subCallId → rootCallId) 归属表，用于校验每个子调用始终属于同一根调用。
  const dispatchRoots = new WeakMap<Session, Map<string, string>>()
  /**
   * 【中文】校验一条 code-dispatch 开始/落定事件：root/parent/sub 三个 id 均非空；
   *   同一 subCallId 的根归属不得中途改变；parent 不是根时必须已登记在该根之下。
   * @param session - 事件所属会话（用于查归属表）。
   * @param event - 待校验事件；非这两类事件直接跳过。
   */
  const validateDispatch = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return
    const root = String(event.data.rootCallId)
    const parent = String(event.data.parentCallId)
    const child = String(event.data.subCallId)
    if (root.length === 0 || parent.length === 0 || child.length === 0) {
      fail(`${event.type} must carry non-empty rootCallId, parentCallId, and subCallId`)
      return
    }
    const roots = dispatchRoots.get(session)
    const known = roots?.get(child)
    if (known !== undefined && known !== root) fail(`${event.type} changed rootCallId for subCallId ${child}`)
    if (parent !== root && roots?.get(parent) !== root) {
      fail(`${event.type} parentCallId ${parent} does not belong to rootCallId ${root}`)
    }
  }
  /**
   * 【中文】把事件的 subCallId → rootCallId 归属登记进归属表（校验通过后调用），
   *   供后续事件的 parent 归属判断使用。注意：这里假设 roots 表已由 seed 建立。
   * @param session - 事件所属会话。
   * @param event - 待登记的 code-dispatch 事件（非目标类型直接跳过）。
   */
  const commitDispatch = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return
    const roots = dispatchRoots.get(session) as Map<string, string>
    roots.set(String(event.data.subCallId), String(event.data.rootCallId))
  }
  /**
   * 【中文】播种：回放一个 session 的全部历史事件——逐条校验并登记 code-dispatch
   *   事件、跟踪 turn 的开闭、发现"回合外追加"立即报错——最后缓存当前开放回合号，
   *   让实时校验不必再重放历史。
   * @param session - 要播种的会话。
   * @returns 该会话当前是否处于开启的 turn 内（回合号，或 null）。
   */
  const seed = (session: Session): number | null => {
    let openTurn: number | null = null
    dispatchRoots.set(session, new Map())
    for (const event of session.snapshotEvents()) {
      validateDispatch(session, event)
      commitDispatch(session, event)
      if (event.type === 'turn/start') openTurn = event.data.turn
      else if (event.type === 'turn/end') openTurn = null
      else if ((event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch')
        && openTurn === null) {
        fail(`${event.type} appended outside any open turn`)
      }
    }
    openTurns.set(session, openTurn)
    return openTurn
  }
  const openTurnFor = (session: Session): number | null => openTurns.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    validateDispatch(session, event)
    commitDispatch(session, event)
    if (event.type === 'turn/start') openTurns.set(session, event.data.turn)
    else if (event.type === 'turn/end') openTurns.set(session, null)
  }, { global: true })
  /**
   * 【中文】核心实时校验钩子：在事件真正分发给监听者之前拦截。对会话事件做
   *   code-dispatch 归属校验与"回合内追加"检查；对工具流水线的三个 waterfall
   *   （tools/pre-execute / tools/execute / tools/post-execute）断言阶段单调推进；
   *   对 tools/result 校验冻结快照并清除阶段标记。
   */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'session/event') {
      const [session, event] = args as [Session, SessionEvent]
      validateDispatch(session, event)
      if ((event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch')
        && openTurnFor(session) === null) {
        fail(`${event.type} appended outside any open turn`)
      }
      return
    }
    if (eventName === 'tools/pre-execute') {
      const exec = args[0] as ToolExecution
      if (stages.has(exec)) fail('tools/pre-execute repeated for one execution')
      stages.set(exec, 'pre')
      return
    }
    if (eventName === 'tools/execute') {
      const exec = args[0] as ToolExecution
      if (stages.get(exec) !== 'pre') fail('tools/execute must follow tools/pre-execute')
      stages.set(exec, 'execute')
      return
    }
    if (eventName === 'tools/post-execute') {
      const exec = args[0] as ToolExecution
      const previous = stages.get(exec)
      if (previous !== 'pre' && previous !== 'execute') {
        fail('tools/post-execute must follow tools/pre-execute or tools/execute')
      }
      stages.set(exec, 'post')
      return
    }
    if (eventName !== 'tools/result') return
    const [exec, result] = args as [Readonly<ToolExecution>, Readonly<ToolExecutionResult>]
    validateResult(exec, result, fail)
    stages.delete(exec)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the tools invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 【中文】函数式插件的 apply 入口：在不变量服务上以 PACKAGE_NAME 登记上面的 install
 *   安装器，完成"包所有权 + 检查逻辑"的一次性挂载。
 * @param ctx - 携带 invariants 服务的 Cordis 上下文。
 * @returns 注册成功后返回该注册的 disposer（卸载时移除全部检查）。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
