/** 同步客户端命令可打开弹层，提交锁只能清理此前的弹层。 */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SessionInputShell } from '../../src/client/input/facade.ts'
import type { InputTriggerController } from '../../src/client/contract/input.ts'

it.each([false, true])('命令弹层在异步=%s 时保留且不发送普通消息', async (deferred) => {
  const ctx = new Context(), calls: string[] = []
  let open = true
  const release = Promise.withResolvers<undefined>()
  const sink = vi.fn(async () => ({ kind: 'success' as const }))
  const controller: InputTriggerController = {
    launcher: { getSnapshot: () => null, subscribe: () => () => {} },
    lexicon: { getSnapshot: () => new Map(), subscribe: () => () => {} },
    track: (_draft, _caret, guard) => { if (guard.tier === 'frozen') calls.push('freeze') },
    arbitrate: () => 'pass', onSpace: () => false,
    serializeReference: async (_source, ref) => ref, openReference: () => false, toggleSource: () => {},
    adjudicate: async () => {
      if (deferred) await release.promise
      calls.push('open'); open = true
      return 'handled'
    },
  }
  const shell = new SessionInputShell({ actx: ctx, inputTriggers: () => controller,
    popup: () => ({ dismiss: () => { calls.push('dismiss'); open = false } }), defaultSink: sink,
    commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: token => token },
  })
  try {
    shell.setDraft('/model'); shell.submit()
    if (deferred) { expect(open).toBe(false); release.resolve(undefined) }
    await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
    expect(calls.indexOf('dismiss')).toBeLessThan(calls.indexOf('open'))
    expect(open).toBe(true); expect(sink).not.toHaveBeenCalled()
  } finally { release.resolve(undefined); shell.dispose() }
})
