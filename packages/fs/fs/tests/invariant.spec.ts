import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import * as FsInvariant from '@deepseek-ai/dsh-fs/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文：装载文件系统不变量注册表与伴生插件；无参数，返回测试 Context。 */
async function setup(): Promise<Context> {
  /** 当前用例的新 Cordis 上下文。 */
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(FsInvariant)
  return ctx
}

/** 中文：构造文件目标；key/displayPath 有可用默认值，返回品牌化 FsTarget。 */
const target = (key = 'file:1', displayPath = 'file.txt'): FsTarget => ({
  targetKey: FsTargetKey(key),
  displayPath,
})

/** 中文：文件系统事件身份不变量测试组。 */
describe('filesystem invariants', () => {
  /** 中文：合法写/编辑意图及 present/absent 观察都应通过；无参数和返回值。 */
  it('accepts decision and observation events with usable identities', async () => {
    /** 已装载文件系统校验规则的上下文。 */
    const ctx = await setup()
    await expect(ctx.waterfall(
      ctx as never, 'fs/write-intent', target(), undefined,
      () => Promise.resolve(undefined),
    )).resolves.toBeUndefined()
    await expect(ctx.waterfall(
      ctx as never, 'fs/edit-intent', target(), undefined,
      () => Promise.resolve(undefined),
    )).resolves.toBeUndefined()
    expect(() => {
      ctx.emit('fs/observed', target(), { kind: 'present', version: FsVersion('v1') }, undefined)
    }).not.toThrow()
    expect(() => { ctx.emit('fs/observed', target(), { kind: 'absent' }, undefined) }).not.toThrow()
    expect(() => { ctx.emit('tools/change') }).not.toThrow()
  })

  /** 中文：空目标键、空显示路径、空版本和未知 kind 都应拒绝；无参数和返回值。 */
  it('rejects empty target and version identities', async () => {
    /** 已装载文件系统校验规则的上下文。 */
    const ctx = await setup()
    expect(() => {
      ctx.emit('fs/observed', target(''), { kind: 'present', version: FsVersion('v1') }, undefined)
    })
      .toThrow(/targetKey must be non-empty/)
    expect(() => {
      ctx.emit('fs/observed', target('file:1', ''), { kind: 'present', version: FsVersion('v1') }, undefined)
    })
      .toThrow(/displayPath must be non-empty/)
    expect(() => {
      ctx.emit('fs/observed', target(), { kind: 'present', version: FsVersion('') }, undefined)
    }).toThrow(/present version must be non-empty/)
    expect(() => {
      ctx.emit('fs/observed', target(), { kind: 'unknown' } as never, undefined)
    }).toThrow(/kind must be present or absent/)
  })
})
/**
 * 中文说明：
 * - 文件职责：验证文件系统决策和观察事件携带可用目标标识、显示路径及版本。
 * - 技术维度：使用 Vitest、Cordis waterfall/emit、不变量伴生插件和品牌字符串。
 * - 产品维度：保证文件写入与观察记录可稳定关联具体文件，避免空身份污染日志和工具状态。
 * - 逻辑维度：setup 装载规则，target 构造目标，再测试合法决策/观察与四种无效字段。
 * - 关键边界：present 必须带非空版本；kind 只允许 present/absent；无关工具事件应忽略。
 * - 新手阅读建议：先看 target 的两个身份字段，再比较 fs/write-intent、fs/edit-intent 和 fs/observed。
 */
