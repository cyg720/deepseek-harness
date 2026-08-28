// The Tool-owned keyed-slot type chain: registration shape and composed
// atomic-view props. Generic slot-system duals live in ui-slots tests.
// 文件职责：以编译期负例守护工具调用键控插槽的注册字段和原子视图属性范围。
// 技术维度：使用 Vitest、TypeScript @ts-expect-error 和 SlotRegistry 类型链验证非法代码必须报错。
// 产品维度：防止工具视图获得会话级能力或依赖不存在的预解析字段，保持插件扩展接口清晰。
// 逻辑维度：定义不会执行的 negatives 函数，依次放入缺键、错误列表字段、越权属性和漂移字段四类负例。
// 关键边界：测试价值来自 TypeScript 编译而非运行函数体；每个 @ts-expect-error 必须对应真实错误。
// 新手阅读建议：先看两个 register 负例，再比较 overreaching 与 drifted 访问了哪些不属于 ToolCallViewProps 的字段。
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ToolCallViewProps } from '../src/client/contract/slots.ts'

// 工具视图类型负例测试套件；运行时只确认 negatives 仍是函数。
describe('toolview type negatives (compile-time; body never runs)', () => {
  // 保留所有预期错误位置，函数体故意不执行。
  it('holds the negative samples as expect-error sites', () => {
    // 编译期负例容器。@param slots 键控插槽注册表。@returns 不会实际使用的 ReactNode。@example 仅由 TypeScript 检查，不应调用。
    const negatives = (slots: SlotRegistry) => {
      // Keyed registration requires the key shape field.
      // 键控注册必须包含 key 字段。
      // @ts-expect-error missing `key` on a keyed-slot registration
      slots.register({ name: 'tool.call.toolview' }, (_p: ToolCallViewProps) => null)
      slots.register(
        // @ts-expect-error `id`/`order` belong to list slots, not the keyed hole
        // id/order 属于列表插槽，不能传给键控插槽。
        { name: 'tool.call.toolview', key: 'k', order: 1 },
        (_p: ToolCallViewProps) => null)
      // 尝试越权访问会话宿主能力的渲染函数；props 只能是原子工具视图属性。
      const overreaching = (props: ToolCallViewProps): ReactNode => {
        // @ts-expect-error loadOlder belongs to the conversation host, not an atomic Tool view
        // loadOlder 属于会话宿主，不属于单个工具视图。
        void props.loadOlder
        return null
      }
      void overreaching
      // 模拟接口漂移的渲染函数；工具调用块没有预解析参数字段。
      const drifted = (props: ToolCallViewProps): ReactNode => {
        // @ts-expect-error the Tool call union has no pre-parsed args member
        // 工具调用联合类型只保留原始参数，不提供 argsParsed。
        void props.block.argsParsed
        return null
      }
      void drifted
      return null as ReactNode
    }
    expect(negatives).toBeTypeOf('function')
  })
})
