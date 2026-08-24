// Dynamic-key escape hatches and untouched-key behavior of the terminal core.
// 中文：验证终端插槽核心的动态键逃生接口以及从未注册键的默认行为。
/**
 * 中文说明：
 * - 文件职责：验证 SlotCore 对动态字符串键、强类型键、注入元数据和未触碰键的查询语义。
 * - 技术维度：使用 Vitest、TypeScript 声明合并、泛型插槽组件和冻结空数组。
 * - 产品维度：让运行时插件可安全查询扩展插槽，同时保留编译期 SlotMap 类型收窄。
 * - 逻辑维度：扩展三项 SlotMap，注册根声明，再逐项测试 specDynamic/spec、inject、entries/version/isLive。
 * - 关键边界：specDynamic 可接收任意字符串但未声明返回 undefined；未触碰键版本为 0。
 * - 新手阅读建议：先比较 specDynamic 和 spec 的类型差异，再看 untouched key 的稳定默认值。
 */
import { describe, expect, it } from 'vitest'
import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 中文：为本测试补充两个普通动态键和一个带注入值的插槽声明。 */
  interface SlotMap {
    'dynamic.a': { kind: 'single'; scope: 'root' }
    'dynamic.b': { kind: 'single'; scope: 'root' }
    'surface.injected': { kind: 'single'; scope: 'root'; inject: { token: string } }
  }
}

/** 不渲染内容的固定测试插槽组件。 */
const Comp: SlotComponent<object> = () => null

/** 中文：动态键查询和默认状态测试组。 */
describe('dynamic-key escape hatch', () => {
  /** 中文：specDynamic 读取宽类型字符串键，未声明时返回 undefined；无参数和返回值。 */
  it('specDynamic reads wide-typed specs for string keys; undefined while undeclared', () => {
    /** 当前用例的新 SlotCore。 */
    const core = new SlotCore()
    expect(core.specDynamic('dynamic.a')).toBeUndefined()
    core.register({ name: 'root', children: { 'dynamic.a': { kind: 'single', scope: 'root' } } }, Comp as never)
    expect(core.specDynamic('dynamic.a')).toEqual({ kind: 'single', scope: 'root' })
    expect(core.specDynamic('never.declared')).toBeUndefined()
  })

  /** 中文：spec 按 SlotMap 键收窄并返回已声明规格；无参数和返回值。 */
  it('spec() narrows by SlotMap key', () => {
    /** 当前用例的新 SlotCore。 */
    const core = new SlotCore()
    core.register({ name: 'root', children: { 'dynamic.a': { kind: 'single', scope: 'root' } } }, Comp as never)
    expect(core.spec('dynamic.a')).toEqual({ kind: 'single', scope: 'root' })
    expect(core.spec('dynamic.b')).toBeUndefined()
  })

  /** 中文：父插槽声明的 inject 对象应原样保存在运行时规格中；无参数和返回值。 */
  it('records the parent-declared Slot inject on the runtime spec', () => {
    /** 当前用例的新 SlotCore。 */
    const core = new SlotCore()
    /** 父声明共享给子插槽的注入对象。 */
    const inject = { token: 'shared' }
    core.register({
      name: 'root',
      children: { 'surface.injected': { kind: 'single', scope: 'root', inject } },
    }, Comp as never)
    expect(core.spec('surface.injected')?.inject).toBe(inject)
  })

  /** 中文：未触碰键返回同一个冻结空数组且版本为 0；无参数和返回值。 */
  it('entries/getVersion on an untouched key return the frozen empty array and 0', () => {
    /** 当前用例的新 SlotCore。 */
    const core = new SlotCore()
    expect(core.entries('dynamic.b')).toHaveLength(0)
    expect(core.entries('dynamic.b')).toBe(core.entries('dynamic.b'))
    expect(core.getVersion('dynamic.b')).toBe(0)
  })

  /** 中文：核心从未持有的条目不应被视为存活；无参数和返回值。 */
  it('isLive is false for entries the core never held', () => {
    /** 当前用例的新 SlotCore。 */
    const core = new SlotCore()
    expect(core.isLive({ component: Comp, options: {} })).toBe(false)
  })
})
