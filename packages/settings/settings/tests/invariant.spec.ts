import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SettingsInvariant from '../src/invariant.ts'
import { settingsNamespace } from '../src/index.ts'
import { MemorySettings } from './memory.ts'

/** 中文：装载不变量服务并按 withProvider 决定是否装载内存设置提供者；返回测试 Context。 */
async function setup(withProvider: boolean): Promise<Context> {
  /** 当前用例的新 Cordis 上下文。 */
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SettingsInvariant)
  if (withProvider) await ctx.plugin(MemorySettings)
  return ctx
}

/** 中文：设置更新事件不变量测试组。 */
describe('settings invariants', () => {
  /** 中文：没有活动 settings 服务时发送更新必须失败；无参数和返回值。 */
  it('fails a settings/updated emission without a live settings service', async () => {
    /** 未装载设置提供者的上下文。 */
    const ctx = await setup(false)
    expect(() => {
      ctx.emit('settings/updated', settingsNamespace('ghost'), { a: 1 }, { a: 2 }, 'provider')
    }).toThrow(/without a live settings service/)
  })

  /** 中文：服务存在但命名空间未注册时必须失败；无参数和返回值。 */
  it('fails a settings/updated emission for an unregistered namespace', async () => {
    /** 已装载内存设置提供者的上下文。 */
    const ctx = await setup(true)
    expect(() => {
      ctx.emit('settings/updated', settingsNamespace('ghost'), { a: 1 }, { a: 2 }, 'provider')
    }).toThrow(/unregistered/)
  })

  /** 中文：解析前后值相同的更新不得发布；无参数和返回值。 */
  it('fails a settings/updated emission without a resolved-value change', async () => {
    /** 已装载内存设置提供者的上下文。 */
    const ctx = await setup(true)
    ctx.settings.register(settingsNamespace('ui-theme'), z.object({
      theme: z.string().default('dark'),
    }))
    expect(() => {
      ctx.emit('settings/updated', settingsNamespace('ui-theme'), { theme: 'dark' }, { theme: 'dark' }, 'update')
    }).toThrow(/without a resolved-value change/)
  })

  /** 中文：事件 next 与服务权威状态不一致时必须失败；无参数和返回值。 */
  it('fails a settings/updated emission whose value diverges from the authoritative state', async () => {
    /** 已装载内存设置提供者的上下文。 */
    const ctx = await setup(true)
    ctx.settings.register(settingsNamespace('ui-theme'), z.object({
      theme: z.string().default('dark'),
    }))
    // Fabricated next ≠ the service's current resolved value ({theme: 'dark'}).
    // 中文：伪造的 next 与服务当前解析值 theme=dark 不同，因此不能作为真实更新发布。
    expect(() => {
      ctx.emit('settings/updated', settingsNamespace('ui-theme'), { theme: 'forged' }, { theme: 'dark' }, 'update')
    }).toThrow(/authoritative/)
  })
})
/**
 * 中文说明：
 * - 文件职责：验证 settings/updated 事件必须来自活动设置服务、已注册命名空间和真实解析值变化。
 * - 技术维度：使用 Vitest、Cordis、不变量插件、Schemastery 模式和内存设置提供者。
 * - 产品维度：防止插件伪造或重复发布设置变化，确保界面与运行时看到权威配置。
 * - 逻辑维度：setup 可选装载提供者，四个用例依次覆盖无服务、未注册、无变化和伪造值。
 * - 关键边界：事件 next 必须等于服务当前解析值且不同于 previous；命名空间需先注册。
 * - 新手阅读建议：按四个失败用例从“没有服务”到“值不权威”逐步理解校验层级。
 */
