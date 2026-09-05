// Synthetic long-chat history for browser behavior contracts. The fixture is
// generated through Session so pagination exercises the same event shapes as
// persisted conversations, while unique markers identify semantic rows
// without depending on CSS-module names or virtualizer DOM positions.
/**
 * 文件职责：验证当前模块的关键行为与边界场景（chat-scroll-fixture.ts）。
 * 技术维度：TypeScript、Vitest、属性测试或可控测试替身。
 * 产品维度：防止用户可见流程在重构后发生回归。
 * 逻辑维度：构造输入，调用被测模块，再断言结果或错误。
 * 关键边界：随机数据必须可复现，异步资源必须及时释放。
 * 新手阅读建议：先读辅助函数，再按 describe/it 阅读核心与异常场景。
 */
import {
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
} from '@deepseek-ai/dsh-session'
// Carries the session/title event declaration into this fixture builder.
import type {} from '@deepseek-ai/dsh-session-title'

/** Options for one deterministic long-chat fixture. */
/* 中文说明：interface ChatScrollFixtureOptions 定义本测试所需的数据或行为，用于表达当前功能场景。 */
export interface ChatScrollFixtureOptions {
  /** Marker namespace, used when two sessions share one browser world. */
  readonly markerPrefix: string
  /** Searchable title projected into the sidebar. */
  readonly title: string
  /** Number of closed turns to generate. */
  readonly turns?: number
}

/** Semantic marker helpers returned with a generated fixture. */
/* 中文说明：interface ChatScrollMarkers 定义本测试所需的数据或行为，用于表达当前功能场景。 */
interface ChatScrollMarkers {
  /** Marker painted in the human message for a turn. */
  user(turn: number): string
  /** Marker painted in the final assistant message for a turn. */
  assistant(turn: number): string
  /** Marker painted in one seeded bash call and result. */
  tool(turn: number, index: number): string
}

/** Generated JSONL plus the stable facts browser scenarios assert. */
/* 中文说明：interface ChatScrollFixture 定义本测试所需的数据或行为，用于表达当前功能场景。 */
export interface ChatScrollFixture {
  readonly log: string
  readonly markers: ChatScrollMarkers
  readonly title: string
  readonly turns: number
}

/** 中文说明：常量 DEFAULT_TURNS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_TURNS = 88
/** 中文说明：常量 TOOL_INTERVAL 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TOOL_INTERVAL = 8
/** 中文说明：常量 CODE_INTERVAL 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CODE_INTERVAL = 11

/** 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** 中文说明：函数 suffix 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function suffix(turn: number): string {
  return String(turn).padStart(3, '0')
}

/** 中文说明：函数 markerHelpers 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function markerHelpers(prefix: string): ChatScrollMarkers {
  return {
    user: turn => `CHAT_SCROLL_${prefix}_USER_${suffix(turn)}`,
    assistant: turn => `CHAT_SCROLL_${prefix}_ASSISTANT_${suffix(turn)}`,
    tool: (turn, index) => `CHAT_SCROLL_${prefix}_TOOL_${suffix(turn)}_${String(index)}`,
  }
}

/** 中文说明：函数 appendRequestHeader 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendRequestHeader(session: Session, turn: number, step: number): void {
  session.append('request/header', {
    header: {
      config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      system: `Synthetic chat-scroll request for turn ${String(turn)}, step ${String(step)}.`,
    },
    reason: turn === 1 && step === 1 ? 'initial' : 'change',
  })
}

/** 中文说明：函数 appendAssistant 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendAssistant(session: Session, turn: number, step: number, body: string): void {
  session.append('assistant/message', {
    stream: [],
    turn,
    step,
    message: createAssistantMessage({
      content: text(body),
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
    usage: {
      inputTokens: 2_000 + turn * 7,
      outputTokens: 180 + step * 20,
    },
  }, { surfaceOp: 'append' })
}

/** 中文说明：函数 codeBlock 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function codeBlock(turn: number): string {
  if (turn % CODE_INTERVAL !== 0) return ''
  /** 中文说明：变量 lines 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = Array.from(
    { length: 30 },
    (_, index) => `const scroll_case_${suffix(turn)}_${String(index).padStart(2, '0')} = ${String(turn + index)}`,
  )
  return `\n\n\`\`\`ts\n${lines.join('\n')}\n\`\`\``
}

/** 中文说明：函数 appendToolStep 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function appendToolStep(
  session: Session,
  markers: ChatScrollMarkers,
  turn: number,
): void {
  /** 中文说明：函数值 calls 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const calls = [1, 2].map((index) => {
    /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const marker = markers.tool(turn, index)
    const callId = ToolCallId(`chat-scroll-${suffix(turn)}-${String(index)}`)
    const args = JSON.stringify({
      command: `printf '${marker}\\n'`,
      description: marker,
    })
    return { args, callId, marker }
  })

  session.append('assistant/message', {
    stream: [],
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [
        { type: 'reasoning', text: `Inspecting two scroll fixtures for turn ${String(turn)}.` },
        ...calls.map(call => ({
          type: 'tool-call' as const,
          id: call.callId,
          name: 'bash',
          arguments: call.args,
        })),
      ],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
    usage: { inputTokens: 2_000 + turn * 7, outputTokens: 240, reasoningTokens: 30 },
  }, { surfaceOp: 'append' })

  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const call of calls) {
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = session.append('tool/call', {
      turn,
      step: 1,
      callId: call.callId,
      name: 'bash',
      arguments: call.args,
    })
    session.append('tool/result', {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId: call.callId,
        content: text(Array.from(
          { length: 12 },
          (_, line) => `${call.marker} output line ${String(line + 1).padStart(2, '0')}`,
        ).join('\n')),
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
}

/** 中文说明：函数 fixtureLog 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function fixtureLog(session: Session): string {
  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: Date.now() - 60_000,
      cwd: '{{cwd}}',
      isSeeded: false,
      delegationDepth: 0,
    }),
    ...session.snapshotEvents().map(event => JSON.stringify(event)),
    '',
  ].join('\n')
}

/**
 * Build a multi-page conversation with prose, fenced code, and paired bash
 * calls/results. Every turn is closed, so cold resume cannot repair or mutate
 * the seed before the browser observes it.
 * @param options - Fixture identity and optional turn count.
 * @returns Canonical JSONL and semantic marker helpers.
 */
/* 中文说明：函数 createChatScrollFixture 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
export function createChatScrollFixture(options: ChatScrollFixtureOptions): ChatScrollFixture {
  /** 中文说明：变量 turns 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const turns = options.turns ?? DEFAULT_TURNS
  /** 中文说明：变量 markers 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const markers = markerHelpers(options.markerPrefix)
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = Session.create(SessionId(`chat-scroll-${options.markerPrefix.toLowerCase()}-template`))

  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (let turn = 1; turn <= turns; turn += 1) {
    session.append('turn/start', {
      turn,
    })
    /** 中文说明：变量 user 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const user = session.append('user/message', createUserMessage({
      content: text(
        `${markers.user(turn)} Review the long-running conversation state for turn ${String(turn)}. `
        + 'Keep the visible message stable while history, tools, and new output change around it.',
      ),
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    if (turn === 1) {
      session.append('session/title', {
        title: options.title,
        messageSeqs: [user.seq],
        source: { kind: 'fallback' },
      })
    }

    session.append('step/start', { turn, step: 1 })
    appendRequestHeader(session, turn, 1)
    if (turn % TOOL_INTERVAL === 0) {
      appendToolStep(session, markers, turn)
      session.append('step/end', { turn, step: 1 })
      session.append('step/start', { turn, step: 2 })
      appendRequestHeader(session, turn, 2)
      appendAssistant(
        session,
        turn,
        2,
        `${markers.assistant(turn)} Both tool results are accounted for. `
        + `This settled response keeps turn ${String(turn)} identifiable after paging.${codeBlock(turn)}`,
      )
      session.append('step/end', { turn, step: 2 })
    } else {
      appendAssistant(
        session,
        turn,
        1,
        `${markers.assistant(turn)} The conversation remains readable after several paragraphs.\n\n`
        + `Turn ${String(turn)} deliberately carries enough prose to wrap at narrower viewport widths. `
        + 'The semantic marker stays near the start so geometry probes can find the same rendered row.\n\n'
        + `The closing paragraph makes this a realistic assistant response rather than a one-line list item.${codeBlock(turn)}`,
      )
      session.append('step/end', { turn, step: 1 })
    }
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }

  return { log: fixtureLog(session), markers, title: options.title, turns }
}
