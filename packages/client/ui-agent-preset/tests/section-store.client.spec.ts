/**
 * The agent-preset management controller: a copy dialog is the only way a
 * preset is created, the shipped compositions open in a read-only viewer, and
 * the way into a custom preset's files is the location action — opened on a
 * desktop, revealed as a path where the host has none. Every mutation
 * re-reads the roster because a copy changes more than the row it targeted.
 */
/*
 * 文件职责：验证代理预设界面的 section-store 行为与边界。
 * 技术维度：Vitest、TypeScript、可控测试替身和真实模块组装。
 * 产品维度：防止用户可见行为在重构或扩展后发生回归。
 * 逻辑维度：构造场景输入，调用被测入口，记录状态并断言结果。
 * 关键边界：测试替身需在用例后清理；异步任务不能泄漏到后续场景。
 * 新手阅读建议：先读辅助函数和固定数据，再按 describe 场景顺序阅读。
 */

import { describe, expect, it } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { AgentPresetSectionController, draftBlocker } from '../src/client/section-store.ts'
import type { CopyDraft, PresetRow } from '../src/client/section-store.ts'

/** 中文说明：类型 FakePreset 约束本文件数据字段及允许取值。 */
interface FakePreset { trust: 'system' | 'user'; content: string; name?: string }
/** 中文说明：类型 Recorded 约束本文件数据字段及允许取值。 */
interface Recorded { method: string; payload: unknown }

/** 中文说明：类型 FakeOptions 约束本文件数据字段及允许取值。 */
interface FakeOptions {
  /** Every call the controller made, in order. */
  /* 中文说明：成员 calls 保存可编排测试状态，取值由声明类型限定。 */
  calls?: Recorded[]
  /** Reject `list` with this message. */
  /* 中文说明：成员 failList 保存可编排测试状态，取值由声明类型限定。 */
  failList?: string
  /** Reject `read` with this message. */
  /* 中文说明：成员 failRead 保存可编排测试状态，取值由声明类型限定。 */
  failRead?: string
  /** Reject `copy` with this message. */
  /* 中文说明：成员 failCopy 保存可编排测试状态，取值由声明类型限定。 */
  failCopy?: string
  /** Reject `openDocument` with this message. */
  /* 中文说明：成员 failOpen 保存可编排测试状态，取值由声明类型限定。 */
  failOpen?: string
  /** Reject `remove` with this message. */
  /* 中文说明：成员 failRemove 保存可编排测试状态，取值由声明类型限定。 */
  failRemove?: string
  /** Reject `settings.update` with this message. */
  /* 中文说明：成员 failSettings 保存可编排测试状态，取值由声明类型限定。 */
  failSettings?: string
  /** Throw from `list` rather than answering, as a dead transport does. */
  /* 中文说明：成员 throwList 保存可编排测试状态，取值由声明类型限定。 */
  throwList?: boolean
  /** Throw from `read`, as a dead transport does. */
  /* 中文说明：成员 throwRead 保存可编排测试状态，取值由声明类型限定。 */
  throwRead?: boolean
  /** Throw from `copy`, as a dead transport does. */
  /* 中文说明：成员 throwCopy 保存可编排测试状态，取值由声明类型限定。 */
  throwCopy?: boolean
  /** Throw from `openDocument`, as a dead transport does. */
  /* 中文说明：成员 throwOpen 保存可编排测试状态，取值由声明类型限定。 */
  throwOpen?: boolean
  /** Whether the deployment configures a writable root. */
  /* 中文说明：成员 authorable 保存可编排测试状态，取值由声明类型限定。 */
  authorable?: boolean
  /** Whether the host can open a preset directory on a desktop. */
  /* 中文说明：成员 hasDocument 保存可编排测试状态，取值由声明类型限定。 */
  hasDocument?: boolean
  /** Hold `remove` until this resolves, to observe the in-flight state. */
  /* 中文说明：成员 holdRemove 保存可编排测试状态，取值由声明类型限定。 */
  holdRemove?: Promise<void>
}

/** 中文说明：测试场景的局部值 ok，取值由紧邻初始化决定，仅在当前作用域使用。 */
const ok = (value: unknown) => Promise.resolve({ rpcId: 'r', result: { ok: true as const, value } })
/** 中文说明：测试场景的局部值 fail，取值由紧邻初始化决定，仅在当前作用域使用。 */
const fail = (message: string) =>
  Promise.resolve({ rpcId: 'r', result: { ok: false as const, error: { code: 'internal', message, details: {} } } })

/**
 * A wire face over an in-memory preset store: copies land, so the roster the
 * controller re-reads after a copy is the one the copy produced.
 * @param presets - the starting compositions by id.
 * @param defaultId - the preset a session with no choice gets.
 * @param options - failure injection and call recording.
 * @returns the fake client.
 */
/* 中文说明：函数 fakeApi 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function fakeApi(
  presets: Map<string, FakePreset>,
  defaultId: { id: string },
  options: FakeOptions = {},
): Pick<IApiClient, 'agentPresets' | 'settings'> {
  /** 中文说明：测试场景的局部值 record，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const record = (method: string, payload: unknown): void => { options.calls?.push({ method, payload }) }
  return {
    agentPresets: {
      list: () => {
        record('list', {})
        if (options.throwList === true) return Promise.reject(new Error('socket closed'))
        if (options.failList !== undefined) return fail(options.failList)
        return ok({
          presets: [...presets].map(([id, preset]) => ({
            id, trust: preset.trust, isDefault: id === defaultId.id,
            ...preset.name === undefined ? {} : { name: preset.name },
          })),
          authorable: options.authorable ?? true,
          hasDocument: options.hasDocument ?? true,
        })
      },
      read: (payload: { agentPreset: string }) => {
        record('read', payload)
        if (options.throwRead === true) return Promise.reject(new Error('socket closed'))
        if (options.failRead !== undefined) return fail(options.failRead)
        /** 中文说明：测试场景的局部值 preset，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const preset = presets.get(payload.agentPreset)
        /* v8 ignore next -- every test reads an id the fake store holds */
        if (preset === undefined) return fail(`unknown preset ${payload.agentPreset}`)
        return ok({
          agentPreset: payload.agentPreset,
          trust: preset.trust,
          content: preset.content,
          ...preset.name === undefined ? {} : { name: preset.name },
        })
      },
      copy: (payload: { from: string; agentPreset: string; name?: string }) => {
        record('copy', payload)
        if (options.throwCopy === true) return Promise.reject(new Error('socket closed'))
        if (options.failCopy !== undefined) return fail(options.failCopy)
        /** 中文说明：测试场景的局部值 source，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const source = presets.get(payload.from)
        /* v8 ignore next -- every test copies a source the fake store holds */
        if (source === undefined) return fail(`unknown preset ${payload.from}`)
        presets.set(payload.agentPreset, {
          trust: 'user',
          content: source.content,
          ...payload.name === undefined ? {} : { name: payload.name },
        })
        return ok({ agentPreset: payload.agentPreset })
      },
      openDocument: (payload: { agentPreset: string }) => {
        record('openDocument', payload)
        if (options.throwOpen === true) return Promise.reject(new Error('socket closed'))
        if (options.failOpen !== undefined) return fail(options.failOpen)
        return (options.hasDocument ?? true)
          ? ok({ opened: true })
          : ok({ opened: false, path: `/presets/${payload.agentPreset}` })
      },
      remove: async (payload: { agentPreset: string }) => {
        record('remove', payload)
        await options.holdRemove
        if (options.failRemove !== undefined) return await fail(options.failRemove)
        presets.delete(payload.agentPreset)
        return await ok({})
      },
    },
    settings: {
      update: (payload: { ns: string; patch: { default?: string } }) => {
        record('settings.update', payload)
        if (options.failSettings !== undefined) return fail(options.failSettings)
        /* v8 ignore next -- the controller only ever patches `default` */
        defaultId.id = payload.patch.default ?? defaultId.id
        return ok({})
      },
    },
  } as unknown as Pick<IApiClient, 'agentPresets' | 'settings'>
}

/** 中文说明：函数 seed 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function seed(): Map<string, FakePreset> {
  return new Map<string, FakePreset>([
    ['standard', { trust: 'system', content: '- id: tool-bash\n', name: '标准模式' }],
    ['mine', { trust: 'user', content: '- id: tool-read\n' }],
  ])
}

/** 中文说明：函数 harness 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function harness(options: FakeOptions = {}) {
  /** 中文说明：测试场景的局部值 presets，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const presets = seed()
  /** 中文说明：标识或顺序值 defaultId，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const defaultId = { id: 'standard' }
  /** 中文说明：按序保存的数据集合 calls，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const calls: Recorded[] = []
  /** 中文说明：测试场景的局部值 rosterChanges，取值由紧邻初始化决定，仅在当前作用域使用。 */
  let rosterChanges = 0
  /** 中文说明：异步取消状态 controller，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const controller = new AgentPresetSectionController(
    fakeApi(presets, defaultId, { ...options, calls: options.calls ?? calls }),
    () => { rosterChanges += 1 },
  )
  return { controller, presets, defaultId, calls, rosterChanges: () => rosterChanges }
}

/** 中文说明：函数 copyOf 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function copyOf(controller: AgentPresetSectionController): CopyDraft {
  /** 中文说明：测试场景的局部值 { copy }，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const { copy } = controller.store.getSnapshot()
  if (copy === null) throw new Error('expected an open copy dialog')
  return copy
}

describe('loading the roster', () => {
  it('maps the roster onto rows with the capability flags', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ authorable: true, hasDocument: false })

    await controller.load()

    /** 中文说明：当前状态或快照 state，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.authorable).toBe(true)
    expect(state.hasDocument).toBe(false)
    expect(state.rows.map((row: PresetRow) => row.id)).toEqual(['standard', 'mine'])
    expect(state.rows[0]).toMatchObject({ trust: 'system', isDefault: true, name: '标准模式' })
  })

  it('reports an empty roster as unavailable, not as an error', async () => {
    /** 中文说明：异步取消状态 { controller, presets }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, presets } = harness()
    presets.clear()

    await controller.load()

    expect(controller.store.getSnapshot().status).toBe('unavailable')
  })

  it('keeps one load in flight rather than stacking reads', async () => {
    /** 中文说明：按序保存的数据集合 { controller, calls }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, calls } = harness()

    await Promise.all([controller.load(), controller.load()])

    expect(calls.filter(call => call.method === 'list')).toHaveLength(1)
  })

  it('surfaces a refusal as the page error', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ failList: 'not for you' })

    await controller.load()

    /** 中文说明：当前状态或快照 state，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('not for you')
  })

  it('folds a dead transport into the same error surface', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ throwList: true })

    await controller.load()

    expect(controller.store.getSnapshot().status).toBe('error')
    expect(controller.store.getSnapshot().error).toContain('socket closed')
  })
})

describe('the read-only viewer', () => {
  it('opens a shipped composition under its display name', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness()
    await controller.load()

    await controller.view('standard')

    expect(controller.store.getSnapshot().view).toEqual({
      id: 'standard', title: '标准模式', content: '- id: tool-bash\n',
    })
  })

  it('falls back to the id when the preset published no name', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness()
    await controller.load()

    await controller.view('mine')

    expect(controller.store.getSnapshot().view?.title).toBe('mine')
  })

  it('closes without touching the list', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness()
    await controller.load()
    await controller.view('standard')

    controller.closeView()

    expect(controller.store.getSnapshot().view).toBeNull()
    expect(controller.store.getSnapshot().rows).toHaveLength(2)
  })

  it('puts a read refusal on the page rather than opening empty', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ failRead: 'no peeking' })
    await controller.load()

    await controller.view('standard')

    expect(controller.store.getSnapshot().view).toBeNull()
    expect(controller.store.getSnapshot().error).toBe('no peeking')
  })

  it('folds a dead transport into the same error surface', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ throwRead: true })
    await controller.load()

    await controller.view('standard')

    expect(controller.store.getSnapshot().error).toContain('socket closed')
  })
})

describe('the copy dialog', () => {
  it('opens over the source with its display name in the title', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness()
    await controller.load()

    controller.beginCopy('standard')

    expect(copyOf(controller)).toMatchObject({
      from: 'standard', fromTitle: '标准模式', id: '', name: '', saving: false,
    })
  })

  it('falls back to the source id when it published no name', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness()
    await controller.load()

    controller.beginCopy('mine')

    expect(copyOf(controller).fromTitle).toBe('mine')
  })

  it('cancel discards whatever was typed', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness()
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('half-typed')

    controller.cancelCopy()

    expect(controller.store.getSnapshot().copy).toBeNull()
  })

  it('ignores field edits and submits with no dialog open', async () => {
    /** 中文说明：按序保存的数据集合 { controller, calls }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, calls } = harness()
    await controller.load()

    controller.setCopyId('typed-into-nothing')
    controller.setCopyName('nameless')
    await controller.confirmCopy()

    expect(controller.store.getSnapshot().copy).toBeNull()
    expect(calls.some(call => call.method === 'copy')).toBe(false)
  })

  it('typing clears the previous failure', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ failCopy: 'disk full' })
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')
    await controller.confirmCopy()
    expect(copyOf(controller).error).toBe('disk full')

    controller.setCopyName('renamed')

    expect(copyOf(controller).error).toBeNull()
  })
})

describe('the copy blocker', () => {
  /** 中文说明：按序保存的数据集合 rows，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const rows: PresetRow[] = [
    { id: 'standard', trust: 'system', isDefault: true },
    { id: 'mine', trust: 'user', isDefault: false },
  ]
  /** 中文说明：测试场景的局部值 draft，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const draft = (id: string): CopyDraft =>
    ({ from: 'standard', fromTitle: '标准模式', id, name: '', saving: false, error: null })

  it('requires an id, a containable shape, and a free name', () => {
    expect(draftBlocker(draft(''), rows)).toBe('idRequired')
    expect(draftBlocker(draft('../escape'), rows)).toBe('idInvalid')
    expect(draftBlocker(draft('Upper'), rows)).toBe('idInvalid')
    expect(draftBlocker(draft('mine'), rows)).toBe('idTaken')
    expect(draftBlocker(draft('my-copy'), rows)).toBeUndefined()
  })
})

describe('submitting a copy', () => {
  it('copies, re-reads the roster, announces the change, and opens the files', async () => {
    /** 中文说明：测试场景的局部值 解构结果，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, calls, rosterChanges } = harness()
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')
    controller.setCopyName('我的模式')

    await controller.confirmCopy()

    /** 中文说明：当前状态或快照 state，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const state = controller.store.getSnapshot()
    expect(state.copy).toBeNull()
    expect(state.rows.map(row => row.id)).toContain('my-copy')
    expect(rosterChanges()).toBe(1)
    expect(calls.find(call => call.method === 'copy')?.payload)
      .toEqual({ from: 'standard', agentPreset: 'my-copy', name: '我的模式' })
    // A preset is its files from here on, so landing in them completes the
    // copy rather than following it.
    expect(calls.find(call => call.method === 'openDocument')?.payload)
      .toEqual({ agentPreset: 'my-copy' })
  })

  it('omits an empty name so the copy falls back to its id', async () => {
    /** 中文说明：按序保存的数据集合 { controller, calls }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, calls } = harness()
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')
    controller.setCopyName('   ')

    await controller.confirmCopy()

    expect(calls.find(call => call.method === 'copy')?.payload)
      .toEqual({ from: 'standard', agentPreset: 'my-copy' })
  })

  it('reveals the new directory as text where the host has no desktop', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ hasDocument: false })
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')

    await controller.confirmCopy()

    expect(controller.store.getSnapshot().revealedPaths['my-copy']).toBe('/presets/my-copy')
  })

  it('keeps the dialog open with the refusal on it', async () => {
    /** 中文说明：异步取消状态 { controller, rosterChanges }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, rosterChanges } = harness({ failCopy: 'id already exists' })
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')

    await controller.confirmCopy()

    expect(copyOf(controller)).toMatchObject({ saving: false, error: 'id already exists' })
    expect(rosterChanges()).toBe(0)
  })

  it('folds a dead transport into the dialog error', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ throwCopy: true })
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('my-copy')

    await controller.confirmCopy()

    expect(copyOf(controller).error).toContain('socket closed')
  })

  it('refuses to submit while blocked or already saving', async () => {
    /** 中文说明：按序保存的数据集合 { controller, calls }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, calls } = harness()
    await controller.load()
    controller.beginCopy('standard')
    controller.setCopyId('mine')

    await controller.confirmCopy()

    expect(calls.some(call => call.method === 'copy')).toBe(false)
  })
})

describe('the location action', () => {
  it('opens the directory and leaves the page alone on a desktop host', async () => {
    /** 中文说明：按序保存的数据集合 { controller, calls }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, calls } = harness()
    await controller.load()

    await controller.openLocation('mine')

    expect(calls.find(call => call.method === 'openDocument')?.payload).toEqual({ agentPreset: 'mine' })
    expect(controller.store.getSnapshot().revealedPaths).toEqual({})
  })

  it('reveals the path on the row where the host has none', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ hasDocument: false })
    await controller.load()

    await controller.openLocation('mine')

    expect(controller.store.getSnapshot().revealedPaths).toEqual({ mine: '/presets/mine' })
  })

  it('drops a revealed path once its preset leaves the roster', async () => {
    /** 中文说明：异步取消状态 { controller, presets }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, presets } = harness({ hasDocument: false })
    await controller.load()
    await controller.openLocation('mine')
    presets.delete('mine')

    await controller.load()

    expect(controller.store.getSnapshot().revealedPaths).toEqual({})
  })

  it('surfaces a refusal as the page error', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ failOpen: 'not yours' })
    await controller.load()

    await controller.openLocation('mine')

    expect(controller.store.getSnapshot().error).toBe('not yours')
  })

  it('folds a dead transport into the same error surface', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ throwOpen: true })
    await controller.load()

    await controller.openLocation('mine')

    expect(controller.store.getSnapshot().error).toContain('socket closed')
  })
})

describe('deleting', () => {
  it('asks first, then deletes, re-reads, and announces the change', async () => {
    /** 中文说明：异步取消状态 { controller, rosterChanges }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, rosterChanges } = harness()
    await controller.load()

    controller.confirmDelete('mine')
    expect(controller.store.getSnapshot().pendingDelete).toBe('mine')
    await controller.remove()

    /** 中文说明：当前状态或快照 state，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const state = controller.store.getSnapshot()
    expect(state.pendingDelete).toBeNull()
    expect(state.rows.map(row => row.id)).not.toContain('mine')
    expect(rosterChanges()).toBe(1)
  })

  it('dismisses the confirmation without deleting', async () => {
    /** 中文说明：按序保存的数据集合 { controller, calls }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, calls } = harness()
    await controller.load()
    controller.confirmDelete('mine')

    controller.confirmDelete(null)
    await controller.remove()

    expect(controller.store.getSnapshot().rows.map(row => row.id)).toContain('mine')
    expect(calls.some(call => call.method === 'remove')).toBe(false)
  })

  it('ignores a second confirmation while one delete is in flight', async () => {
    /** 中文说明：释放资源的清理函数 release，取值由紧邻初始化决定，仅在当前作用域使用。 */
    let release = (): void => {}
    /** 中文说明：异步等待或同步门 gate，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const gate = new Promise<void>((resolve) => { release = resolve })
    /** 中文说明：按序保存的数据集合 { controller, calls }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, calls } = harness({ holdRemove: gate })
    await controller.load()
    controller.confirmDelete('mine')
    /** 中文说明：测试场景的局部值 removal，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const removal = controller.remove()

    controller.confirmDelete('standard')
    await controller.remove()
    release()
    await removal

    expect(calls.filter(call => call.method === 'remove')).toHaveLength(1)
  })

  it('surfaces a refusal and clears the confirmation', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ failRemove: 'shipped preset' })
    await controller.load()
    controller.confirmDelete('mine')

    await controller.remove()

    /** 中文说明：当前状态或快照 state，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const state = controller.store.getSnapshot()
    expect(state.error).toBe('shipped preset')
    expect(state.pendingDelete).toBeNull()
    expect(state.deleting).toBe(false)
  })

  it('folds a dead transport into the same error surface', async () => {
    /** 中文说明：异步取消状态 { controller, presets }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, presets } = harness()
    await controller.load()
    presets.clear()
    /** 中文说明：测试场景的局部值 broken，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const broken = new AgentPresetSectionController({
      agentPresets: {
        list: () => Promise.reject(new Error('gone')),
        remove: () => Promise.reject(new Error('socket closed')),
      },
      settings: {},
    } as unknown as Pick<IApiClient, 'agentPresets' | 'settings'>)
    broken.confirmDelete('mine')

    await broken.remove()

    expect(broken.store.getSnapshot().error).toContain('socket closed')
  })
})

describe('a controller with no roster listener', () => {
  it('completes a delete without anyone to notify', async () => {
    // The rosterChanged callback is optional wiring, not a requirement: a
    // page composed without sibling surfaces still deletes cleanly.
    /** 中文说明：测试场景的局部值 presets，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const presets = seed()
    /** 中文说明：测试场景的局部值 alone，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const alone = new AgentPresetSectionController(fakeApi(presets, { id: 'standard' }))
    await alone.load()
    alone.confirmDelete('mine')

    await alone.remove()

    expect(alone.store.getSnapshot().rows.map(row => row.id)).not.toContain('mine')
  })
})

describe('the default preset', () => {
  it('writes the setting and re-reads the roster', async () => {
    /** 中文说明：异步取消状态 { controller, defaultId }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller, defaultId } = harness()
    await controller.load()

    await controller.makeDefault('mine')

    expect(defaultId.id).toBe('mine')
    expect(controller.store.getSnapshot().rows.find(row => row.id === 'mine')?.isDefault).toBe(true)
  })

  it('surfaces a settings refusal as the page error', async () => {
    /** 中文说明：异步取消状态 { controller }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { controller } = harness({ failSettings: 'read-only settings' })
    await controller.load()

    await controller.makeDefault('mine')

    expect(controller.store.getSnapshot().error).toContain('read-only settings')
  })
})
