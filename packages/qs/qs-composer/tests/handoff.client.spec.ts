import { describe, expect, it } from 'vitest'
import {
  isBlankSubmission, isHandoffReady, isOperationCurrent, newRequestedSessionId, nextOpId,
  queueRows, shouldSubmitOnEnter,
} from '../src/client/handoff.ts'

describe('无会话发送的本地编排', () => {
  it('每次提交分配新的本地操作代次', () => {
    expect(nextOpId(1)).toBe('qs-op-1')
    expect(nextOpId(2)).not.toBe(nextOpId(1))
  })

  it('只有当前代次的回调有效；取消后即使回到同一会话也无效', () => {
    expect(isOperationCurrent('qs-op-1', 'qs-op-1')).toBe(true)
    expect(isOperationCurrent('qs-op-2', 'qs-op-1')).toBe(false)
    expect(isOperationCurrent(undefined, 'qs-op-1')).toBe(false)
  })

  it('空输入（含纯空白）不得提交', () => {
    expect(isBlankSubmission('')).toBe(true)
    expect(isBlankSubmission('   \n ')).toBe(true)
    expect(isBlankSubmission('看一下设备状态')).toBe(false)
  })

  it('Enter 提交、Shift+Enter 换行', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
    expect(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
    expect(shouldSubmitOnEnter({ key: 'a', shiftKey: false, isComposing: false })).toBe(false)
  })

  it('IME 组合期的 Enter 不提交', () => {
    expect(shouldSubmitOnEnter({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
  })
})

describe('跨页面唯一的预分配会话 id', () => {
  it('两次生成不相同，且不依赖页面内序号', () => {
    const first = newRequestedSessionId()
    const second = newRequestedSessionId()
    expect(first).not.toBe(second)
    expect(first.startsWith('qs-')).toBe(true)
  })
})

describe('无会话交接的就绪判据', () => {
  const ready = {
    pendingOpId: 'qs-op-1',
    currentOpId: 'qs-op-1',
    requestedSessionId: 'qs-a',
    currentSessionId: 'qs-a',
    hasInputActions: true,
  }

  it('三个条件同时成立才就绪', () => {
    expect(isHandoffReady(ready)).toBe(true)
  })

  it('请求的会话还没成为当前会话时不交接', () => {
    expect(isHandoffReady({ ...ready, currentSessionId: 'qs-b' })).toBe(false)
    expect(isHandoffReady({ ...ready, currentSessionId: undefined })).toBe(false)
  })

  it('输入动作还没物化时不交接', () => {
    expect(isHandoffReady({ ...ready, hasInputActions: false })).toBe(false)
  })

  it('操作已被取消（代次不匹配）时不交接', () => {
    expect(isHandoffReady({ ...ready, pendingOpId: 'qs-op-2' })).toBe(false)
    expect(isHandoffReady({ ...ready, currentOpId: undefined })).toBe(false)
  })
})

describe('队列视图模型', () => {
  it('取 text，回退 preview，并带上落点', () => {
    const rows = queueRows([
      { id: 'm1', text: '甲', preview: '甲…', placement: 'queued' },
      { id: 'm2', text: null, preview: '乙…', placement: 'steering' },
    ])
    expect(rows).toEqual([
      { id: 'm1', text: '甲', placement: 'queued', editable: true },
      { id: 'm2', text: '乙…', placement: 'steering', editable: false },
    ])
  })
})

/** 无文本预览的混合队列保留身份和不可编辑状态，不伪造正文。 */
it('缺失队列预览显示空文本', () => {
  expect(queueRows([{ id: 'media', placement: 'queued' }])).toEqual([{ id: 'media', text: '', placement: 'queued', editable: false }])
})
