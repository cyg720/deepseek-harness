/**
 * The `plan` projection unit (session-projection RFC's complete example): a
 * event fold over the session log. `command/run` records named `plan` with
 * recorded input set the candidate target (`off` → false, anything else →
 * true); `command/done` keeps successful candidates and drops failures;
 * `plan/mode` commits and clears a selection. `view` reports pending only while
 * an outstanding selection differs from the logged state.
 * Pending is thereby a pure replay quantity — a cold fold answers it without
 * the service's in-memory intent. Composition without plan-mode has no `plan`
 * key; unloading the fiber removes it (HMR safety).
 */
/*
 * 文件职责：验证 projection.spec.ts 覆盖的计划模式行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身。
 * 产品维度：保障 Agent 使用计划模式时得到稳定且可重放的结果。
 * 逻辑维度：准备上下文与事件，触发被测流程，再核对状态、输出和资源清理。
 * 关键边界：持久化事件必须可重放；连接和异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数，再按 describe/it 阅读正常、恢复与失败场景。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'

/** 中文说明：interface Bench 定义本测试所需的数据或行为，用于表达当前功能场景。 */
interface Bench {
  ctx: Context
  session: Session
  values(): Record<string, unknown>
}

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(withPlanMode: boolean): Promise<Bench> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  if (withPlanMode) await ctx.plugin(PlanModeController, { section: 'plan policy' })
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = ctx.sessions.create()
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return {
    ctx,
    session,
    values: () => ctx.sessionProjections.snapshot(session).values,
  }
}

/** Append one logged /plan selection record (the executor's command/run shape). */
/* 中文说明：函数 runPlanCommand 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function runPlanCommand(session: Session, args: string, index: number): CommandId {
  /** 中文说明：变量 commandId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const commandId = CommandId(`plan-proj-${String(index)}`)
  session.append('command/run', {
    commandId,
    name: 'plan',
    args,
    source: { kind: 'user' },
  })
  return commandId
}

/** Append the paired settlement for one projected plan command. */
/* 中文说明：函数 settlePlanCommand 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function settlePlanCommand(session: Session, commandId: CommandId, kind: 'success' | 'error'): void {
  session.append('command/done', { commandId, kind })
}

/** Commit one plan/mode flip inside an open turn (the invariant's turn-enclosure rule). */
/* 中文说明：函数 commitPlanMode 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function commitPlanMode(session: Session, active: boolean, turn: number): void {
  session.append('turn/start', { turn })
  session.append('plan/mode', { active })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('plan projection unit', () => {
  it('serves inactive/not-pending for the empty log', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(true)
    expect(bench.values()).toEqual({ plan: { active: false, pending: false } })
  })

  it('a logged /plan selection reads pending until plan/mode records it', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(true)
    /** 中文说明：变量 commandId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commandId = runPlanCommand(bench.session, '', 0)
    expect(bench.values().plan).toEqual({ active: false, pending: true })
    settlePlanCommand(bench.session, commandId, 'success')
    expect(bench.values().plan).toEqual({ active: false, pending: true })
    commitPlanMode(bench.session, true, 0)
    expect(bench.values().plan).toEqual({ active: true, pending: false })
  })

  it('drops a plan selection when its command settles with an error', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(true)
    commitPlanMode(bench.session, true, 0)
    /** 中文说明：变量 commandId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commandId = runPlanCommand(bench.session, 'off', 0)
    expect(bench.values().plan).toEqual({ active: true, pending: true })
    settlePlanCommand(bench.session, commandId, 'error')
    expect(bench.values().plan).toEqual({ active: true, pending: false })
  })

  it('folds `off` args and non-plan commands correctly, and a matching selection is not pending', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(true)
    commitPlanMode(bench.session, true, 0)
    // Another command's record never touches plan state.
    bench.session.append('command/run', {
      commandId: CommandId('other-1'), name: 'compact', args: '', source: { kind: 'user' },
    })
    expect(bench.values().plan).toEqual({ active: true, pending: false })
    // A command lifecycle with omitted input carries no plan selection.
    bench.session.append('command/run', {
      commandId: CommandId('plan-no-input'), name: 'plan', source: { kind: 'user' },
    })
    expect(bench.values().plan).toEqual({ active: true, pending: false })
    runPlanCommand(bench.session, ' off', 1)
    expect(bench.values().plan).toEqual({ active: true, pending: true })
    commitPlanMode(bench.session, false, 1)
    expect(bench.values().plan).toEqual({ active: false, pending: false })
    // Selecting the already-committed state folds to not-pending (net zero).
    runPlanCommand(bench.session, 'off', 2)
    expect(bench.values().plan).toEqual({ active: false, pending: false })
  })

  it('a /plan message-argument selection targets plan mode', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(true)
    runPlanCommand(bench.session, ' sketch the refactor first', 0)
    expect(bench.values().plan).toEqual({ active: false, pending: true })
  })

  it('has no plan key when plan-mode is not composed', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(false)
    expect('plan' in bench.values()).toBe(false)
  })

  it('drops the key when the plan-mode fiber unloads (HMR safety)', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(false)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await bench.ctx.plugin(PlanModeController, { section: 'plan policy' })
    expect(bench.values().plan).toEqual({ active: false, pending: false })
    await fiber.dispose()
    expect('plan' in bench.values()).toBe(false)
  })

  it('cold replay recovers pending from the log alone (a fresh registry refolds it)', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(true)
    runPlanCommand(bench.session, '', 0)
    // A second registry over the same log (the cold-read shape): no service
    // memory involved, the fold alone answers {active:false, pending:true}.
    /** 中文说明：变量 cold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cold = await harness(true)
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const event of bench.session.events) {
      if (event.type === 'command/run' || event.type === 'command/done' || event.type === 'plan/mode') {
        cold.session.append(event.type, event.data)
      }
    }
    expect(cold.values().plan).toEqual({ active: false, pending: true })
  })
})
