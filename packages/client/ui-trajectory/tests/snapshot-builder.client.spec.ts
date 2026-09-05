/**
 * 文件职责：验证运行轨迹的 snapshot-builder.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、虚拟列表和服务替身。
 * 产品维度：防止运行轨迹展示与操作流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：计时器、观察器、DOM 尺寸和异步请求必须恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和异常场景阅读。
 */
import { describe, expect, it } from 'vitest'
import type { RequestView } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  TrajectoryContribution, TrajectoryConversationViewNode, TrajectoryRequestHeaderState,
} from '../src/client/trajectory-contract.ts'
import { TrajectorySnapshotBuilder } from '../src/client/trajectory-snapshot-builder.ts'

const EMPTY_LOCATION_DATA_SOURCE = { getSnapshot: () => undefined, subscribe: () => () => {} }
const EMPTY_LOCATION_DATA = { get: () => undefined, source: () => EMPTY_LOCATION_DATA_SOURCE }

function assistantRequest(startSeq: number, step: number): Extract<RequestView, { purpose: 'assistant' }> {
  return {
    purpose: 'assistant',
    startSeq,
    turn: 1,
    step,
    startedAt: startSeq,
    completedAt: startSeq + 1,
    status: 'complete',
  }
}

/** 中文说明：函数 contribution 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function contribution(
  key: string,
  anchorSeq: number,
  data: TrajectoryContribution,
): TrajectoryConversationViewNode {
  return {
    key, kind: key, id: key, target: 'trajectory', anchorSeq,
    location: { kind: 'session' },
    data,
  }
}

/** 中文说明：函数 stepLocation 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stepLocation(turn: number, step: number): TrajectoryRequestHeaderState['location'] {
  const data = EMPTY_LOCATION_DATA
  const stepLocation = {
    turn,
    step,
    start: undefined,
    end: undefined,
    status: 'unknown' as const,
    data,
  }
  /** 中文说明：测试局部值 turnLocation，由紧邻初始化决定。 */
  const turnLocation = {
    turn,
    start: undefined,
    end: undefined,
    status: 'unknown' as const,
    steps: [stepLocation],
    data,
  }
  return { kind: 'step', turn: turnLocation, step: stepLocation }
}

/** 中文说明：函数 compactionRequest 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function compactionRequest(startSeq: number): Extract<RequestView, { purpose: 'compaction' }> {
  return {
    purpose: 'compaction',
    startSeq,
    turn: null,
    step: 0,
    startedAt: startSeq,
    completedAt: null,
    status: 'running',
  }
}

describe('TrajectorySnapshotBuilder', () => {
  it('inherits one request header across requests without repeating its prompt change', () => {
    /** 中文说明：测试局部值 prompt，由紧邻初始化决定。 */
    const prompt = {
      config: { provider: 'test', model: 'test' },
      system: 'one initial prompt',
      tools: [],
    }
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes: TrajectoryConversationViewNode[] = [
      {
        key: 'header',
        kind: 'trajectory-request-header',
        id: '2',
        target: 'trajectory',
        anchorSeq: 2,
        location: { kind: 'session' },
        data: {
          kind: 'request-header',
          header: {
            seq: 2,
            time: 2,
            prompt,
            change: { seq: 2, time: 2, kind: 'initial' },
            location: { kind: 'session' },
          },
        },
      },
      ...[assistantRequest(3, 1), assistantRequest(5, 2)].map(request => ({
        key: `assistant:${request.step}`,
        kind: 'trajectory-assistant-step',
        id: `1:${request.step}`,
        target: 'trajectory' as const,
        anchorSeq: request.startSeq,
        location: { kind: 'session' as const },
        data: { kind: 'assistant' as const, partial: null, request },
      })),
    ]

    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = new TrajectorySnapshotBuilder().replace({ nodes })

    expect(snapshot.requests.map(request => request.purpose === 'assistant'
      ? request.prompt?.system
      : undefined)).toEqual(['one initial prompt', 'one initial prompt'])
    expect(snapshot.requests.map(request => request.purpose === 'assistant'
      ? request.promptChange?.kind
      : undefined)).toEqual(['initial', undefined])
  })

  it('retains a same-step prompt change when a later series header supplies the latest snapshot', () => {
    const initial = {
      config: { provider: 'test', model: 'test' },
      system: 'initial prompt',
      tools: [],
    }
    const changed = { ...initial, system: 'changed prompt' }
    const nodes: TrajectoryConversationViewNode[] = [
      contribution('header:initial', 2, {
        kind: 'request-header',
        header: {
          seq: 2,
          time: 2,
          prompt: initial,
          change: { seq: 2, time: 2, kind: 'initial' },
          location: { kind: 'session' },
        },
      }),
      contribution('assistant:1', 3, {
        kind: 'assistant',
        partial: null,
        request: assistantRequest(3, 1),
      }),
      contribution('header:change', 5, {
        kind: 'request-header',
        header: {
          seq: 5,
          time: 5,
          prompt: changed,
          change: { seq: 5, time: 5, kind: 'system', previous: initial },
          location: stepLocation(1, 2),
        },
      }),
      contribution('header:series', 6, {
        kind: 'request-header',
        header: {
          seq: 6,
          time: 6,
          prompt: changed,
          location: stepLocation(1, 2),
        },
      }),
      contribution('assistant:2', 7, {
        kind: 'assistant',
        partial: null,
        request: assistantRequest(7, 2),
      }),
    ]

    const snapshot = new TrajectorySnapshotBuilder().replace({ nodes })

    expect(snapshot.requests.map(request => request.purpose === 'assistant'
      ? request.prompt?.system
      : undefined)).toEqual(['initial prompt', 'changed prompt'])
    expect(snapshot.requests.map(request => request.purpose === 'assistant'
      ? request.promptChange?.seq
      : undefined)).toEqual([2, 5])
  })

  it('indexes exact step headers and the active tool schema without backward scans', () => {
    /** 中文说明：测试局部值 basePrompt，由紧邻初始化决定。 */
    const basePrompt = {
      config: { provider: 'test', model: 'base' },
      system: 'base prompt',
      tools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
    }
    /** 中文说明：测试局部值 exactPrompt，由紧邻初始化决定。 */
    const exactPrompt = {
      config: { provider: 'test', model: 'exact' },
      system: 'exact prompt',
      tools: [{ name: 'edit', description: 'Edit', parameters: { type: 'object' } }],
    }
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes: TrajectoryConversationViewNode[] = [
      contribution('header:base', 2, {
        kind: 'request-header',
        header: {
          seq: 2,
          time: 2,
          prompt: basePrompt,
          change: { seq: 2, time: 2, kind: 'initial' },
          location: { kind: 'session' },
        },
      }),
      contribution('assistant:1', 3, {
        kind: 'assistant',
        partial: null,
        request: assistantRequest(3, 1),
      }),
      contribution('assistant:2', 5, {
        kind: 'assistant',
        partial: null,
        request: assistantRequest(5, 2),
      }),
      contribution('header:exact', 6, {
        kind: 'request-header',
        header: {
          seq: 6,
          time: 6,
          prompt: exactPrompt,
          change: { seq: 6, time: 6, kind: 'system', previous: basePrompt },
          location: stepLocation(1, 2),
        },
      }),
      contribution('tool', 7, {
        kind: 'tool',
        root: {
          callId: 'call-edit',
          name: 'edit',
          argsRaw: '{}',
          turn: 1,
          step: 2,
          time: 7,
          subCalls: [],
        },
      }),
    ]

    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = new TrajectorySnapshotBuilder().replace({ nodes })

    expect(snapshot.requests.map(request => request.purpose === 'assistant'
      ? request.prompt?.system
      : undefined)).toEqual(['base prompt', 'exact prompt'])
    expect(snapshot.callSchemas.get('call-edit')).toEqual(exactPrompt.tools[0])
  })

  it('applies session boundaries and turn errors with linear request indexes', () => {
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes: TrajectoryConversationViewNode[] = [
      ...[assistantRequest(1, 1), assistantRequest(3, 2)].map(request => contribution(
        `assistant:${request.step}`,
        request.startSeq,
        { kind: 'assistant', partial: null, request },
      )),
      contribution('turn-end', 5, {
        kind: 'turn-end',
        turn: 1,
        time: 5,
        error: 'turn failed',
        errorCode: 'AUTH',
      }),
      contribution('compact:10', 10, {
        kind: 'compaction',
        request: compactionRequest(10),
      }),
      contribution('compact:12', 12, {
        kind: 'compaction',
        request: compactionRequest(12),
      }),
      contribution('session-end:14', 14, { kind: 'session-end', seq: 14, time: 14 }),
      contribution('session-end:16', 16, { kind: 'session-end', seq: 16, time: 16 }),
    ]

    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = new TrajectorySnapshotBuilder().replace({ nodes })

    expect(snapshot.requests).toMatchObject([
      { purpose: 'assistant', step: 1, status: 'complete' },
      {
        purpose: 'assistant', step: 2, status: 'error', error: 'turn failed', errorCode: 'AUTH',
      },
      { purpose: 'compaction', startSeq: 10, status: 'error', completedAt: 16 },
      { purpose: 'compaction', startSeq: 12, status: 'error', completedAt: 14 },
    ])
  })

  it('keeps cached contribution order across content updates and structural inserts', () => {
    /** 中文说明：测试局部值 builder，由紧邻初始化决定。 */
    const builder = new TrajectorySnapshotBuilder()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = contribution('assistant:1', 1, {
      kind: 'assistant', partial: null, request: assistantRequest(1, 1),
    })
    /** 中文说明：测试局部值 last，由紧邻初始化决定。 */
    const last = contribution('assistant:3', 5, {
      kind: 'assistant', partial: null, request: assistantRequest(5, 3),
    })
    expect(builder.replace({ nodes: [last, first] }).requests.map(request => request.startSeq))
      .toEqual([1, 5])

    /** 中文说明：测试局部值 updatedLast，由紧邻初始化决定。 */
    const updatedLast = contribution('assistant:3', 5, {
      kind: 'assistant',
      partial: null,
      request: { ...assistantRequest(5, 3), status: 'error', error: 'failed' },
    })
    expect(builder.apply({ upserts: [updatedLast] }).requests.map(request => request.startSeq))
      .toEqual([1, 5])

    /** 中文说明：测试局部值 middle，由紧邻初始化决定。 */
    const middle = contribution('assistant:2', 3, {
      kind: 'assistant', partial: null, request: assistantRequest(3, 2),
    })
    expect(builder.apply({ upserts: [middle] }).requests.map(request => request.startSeq))
      .toEqual([1, 3, 5])
  })
})
