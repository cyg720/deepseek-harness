// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { ToolRow } from '../src/client/tool/components/ToolRow.tsx'
import { BashRow } from '../src/client/tool/toolviews/bash-sample.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

/** 中文说明：类型或类 BashRowProps 约束工具或轨迹数据职责。 */
type BashRowProps = Parameters<typeof BashRow>[0]

const t: GenericToolCardProps['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

/** 中文说明：测试局部值 SID，由紧邻初始化决定。 */
const SID = 'root-1' as SessionId

/** 中文说明：函数 listStore 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function listStore() {
  return createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: {
      [SID]: { id: SID, title: 'r', displayTitle: 'r', running: false, blank: false, updatedAt: 0 },
    },
    current: undefined,
    phase: 'ready',
    subagentsByParent: {}, jobsBySession: {},
    currentAddress: undefined,
  })
}

/** 中文说明：函数 bashProps 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function bashProps(block: RunningToolCall | ToolResultNode): BashRowProps {
  return {
    callId: 'c1', toolName: 'bash', block, openFile: vi.fn(),
    sessionId: SID, useSessions: bindSnapshotSelector(listStore()),
    t,
  } as unknown as BashRowProps
}

describe('Tool presentation tails', () => {
  it('ToolRow stopped state renders the warning dot in the leading slot', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <ToolRow t={t} variant="bash" icon={<i data-testid="icon" />} title="Bash" summary="s" body={null} state="stopped" />,
    )
    expect(view.queryByTestId('icon')).toBeNull()
    expect(view.container.querySelector('[data-state="stopped"]')).not.toBeNull()
  })

  it('a settled others-variant row renders the sparkle icon in the leading slot', () => {
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled: ToolResultNode = {
      kind: 'tool-result', seq: 2, time: 2_000, callId: 'c5',
      call: { name: 'todo_write', argsRaw: '{"note":"x"}' },
      callTime: 1_000,
      content: [], isError: false, subCalls: [],
    }
    /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
    const props: GenericToolCardProps = {
      callId: 'c5', toolName: 'todo_write', block: settled, openFile: vi.fn(), t,
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<GenericToolCard {...props} />)
    expect(view.container.querySelector('[data-variant="others"] svg')).not.toBeNull()
    expect(view.container.querySelector('[data-state="ok"]')).not.toBeNull()
  })

  it('BashRow summarizes the description without a row click target', () => {
    /** 中文说明：测试局部值 settled，由紧邻初始化决定。 */
    const settled: ToolResultNode = {
      kind: 'tool-result', seq: 3, time: 3_000, callId: 'c1',
      call: { name: 'bash', argsRaw: '{"command":"make build","description":"Build"}' },
      callTime: 2_000,
      content: [], isError: false, subCalls: [],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<BashRow {...bashProps(settled)} />)
    /** 中文说明：测试局部值 row，由紧邻初始化决定。 */
    const row = view.container.querySelector('[data-sample="bash"]')!
    expect(row.textContent).toContain('Bash')
    expect(row.textContent).toContain('Build')
    expect(row.getAttribute('data-clickable')).toBeNull()
  })

  it('BashRow carries data-state for running and StateDots for error/stopped', () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: RunningToolCall = {
      callId: 'c1', name: 'bash', argsRaw: '{"command":"ls","description":"List"}',
      turn: 1, step: 1, time: 1_000, subCalls: [],
    }
    /** 中文说明：测试局部值 errorResult，由紧邻初始化决定。 */
    const errorResult: ToolResultNode = {
      kind: 'tool-result', seq: 1, time: 1_000, callId: 'c1',
      call: { name: 'bash', argsRaw: '{"command":"boom"}' },
      callTime: 500,
      content: [], isError: true, subCalls: [],
    }
    /** 中文说明：测试局部值 stoppedResult，由紧邻初始化决定。 */
    const stoppedResult: ToolResultNode = {
      ...errorResult,
      error: { name: 'E', code: 'interrupted' },
    }

    /** 中文说明：测试局部值 runningView，由紧邻初始化决定。 */
    const runningView = render(<BashRow {...bashProps(running)} />)
    expect(runningView.container.querySelector('[data-state="running"]')).not.toBeNull()
    expect(runningView.getByText('Bash')).toBeTruthy()
    expect(runningView.getByText('List')).toBeTruthy()
    runningView.unmount()

    /** 中文说明：测试局部值 errorView，由紧邻初始化决定。 */
    const errorView = render(<BashRow {...bashProps(errorResult)} />)
    expect(errorView.container.querySelector('[data-sample="bash"]')).not.toBeNull()
    expect(errorView.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(errorView.getByText('失败')).toBeTruthy()
    errorView.unmount()

    /** 中文说明：测试局部值 stoppedView，由紧邻初始化决定。 */
    const stoppedView = render(<BashRow {...bashProps(stoppedResult)} />)
    expect(stoppedView.container.querySelector('[data-state="stopped"]')).not.toBeNull()
    expect(stoppedView.getByText('已停止')).toBeTruthy()
  })
})
