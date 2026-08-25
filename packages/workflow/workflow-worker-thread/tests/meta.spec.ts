/**
 * 文件职责：验证 meta.spec.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { describe, expect, it } from 'vitest'
import { WorkflowError } from '@deepseek-ai/dsh-workflow'
import { validateMeta } from '../src/meta.ts'

/** Assert a META_INVALID throw whose message matches every given fragment. */
/* 中文说明：函数 expectInvalid 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function expectInvalid(value: unknown, ...fragments: string[]): void {
  /** 中文说明：变量 thrown 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let thrown: unknown
  try {
    validateMeta(value)
  } catch (error: unknown) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(WorkflowError)
  expect((thrown as WorkflowError).code).toBe('META_INVALID')
  /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
  for (const fragment of fragments) {
    expect((thrown as WorkflowError).message).toContain(fragment)
  }
}

describe('validateMeta', () => {
  it('accepts a minimal meta and returns a normalized copy (no aliasing of the input)', () => {
    /** 中文说明：变量 input 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const input = { name: 'audit', description: 'audit the repo' }
    /** 中文说明：变量 meta 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const meta = validateMeta(input)
    expect(meta).toEqual({ name: 'audit', description: 'audit the repo' })
    expect(meta).not.toBe(input)
    input.name = 'mutated'
    expect(meta.name).toBe('audit')
  })

  it('accepts the full shape and rebuilds phases entry by entry', () => {
    /** 中文说明：变量 meta 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const meta = validateMeta({
      name: 'migrate',
      description: 'migrate call sites',
      whenToUse: 'large mechanical sweeps',
      phases: [
        { title: 'Discover', provider: 'openai' },
        { title: 'Transform', detail: 'one agent per file', model: 'deepseek-v4-pro' },
      ],
    })
    expect(meta).toEqual({
      name: 'migrate',
      description: 'migrate call sites',
      whenToUse: 'large mechanical sweeps',
      phases: [
        { title: 'Discover', provider: 'openai' },
        { title: 'Transform', detail: 'one agent per file', model: 'deepseek-v4-pro' },
      ],
    })
  })

  it('rejects non-object values loud', () => {
    expectInvalid(undefined, 'meta must be an object')
    expectInvalid('a string', 'meta must be an object')
    expectInvalid(null, 'meta must be an object')
    expectInvalid([{ name: 'x', description: 'd' }], 'meta must be an object')
  })

  it('rejects unknown fields by name (accepted-then-ignored is banned)', () => {
    expectInvalid({ name: 'x', description: 'd', color: 'red' }, 'meta.color is not a recognized field')
  })

  it('rejects missing or mistyped name/description/whenToUse', () => {
    expectInvalid({ description: 'd' }, 'meta.name must be a non-empty string')
    expectInvalid({ name: '', description: 'd' }, 'meta.name must be a non-empty string')
    expectInvalid({ name: 'x' }, 'meta.description must be a non-empty string')
    expectInvalid({ name: 'x', description: 42 }, 'meta.description must be a non-empty string')
    expectInvalid({ name: 'x', description: 'd', whenToUse: 3 }, 'meta.whenToUse must be a string')
  })

  it('rejects malformed phases, entry by entry', () => {
    expectInvalid({ name: 'x', description: 'd', phases: 'Scan' }, 'meta.phases must be an array')
    expectInvalid({ name: 'x', description: 'd', phases: ['Scan'] }, 'meta.phases[0] must be an object')
    expectInvalid({ name: 'x', description: 'd', phases: [{ title: '' }] }, 'meta.phases[0].title must be a non-empty string')
    expectInvalid({ name: 'x', description: 'd', phases: [{ title: 'Scan', order: 1 }] }, 'meta.phases[0].order is not a recognized field')
    expectInvalid({ name: 'x', description: 'd', phases: [{ title: 'Scan', detail: 9 }] }, 'meta.phases[0].detail must be a string')
    expectInvalid({ name: 'x', description: 'd', phases: [{ title: 'Scan', provider: 9 }] }, 'meta.phases[0].provider must be a string')
    expectInvalid({ name: 'x', description: 'd', phases: [{ title: 'Scan', model: 9 }] }, 'meta.phases[0].model must be a string')
  })

  it('names EVERY violation in one throw, not just the first', () => {
    expectInvalid(
      { description: 7, extra: true, phases: [{ title: 'Scan' }, 'bad'] },
      'meta.extra is not a recognized field',
      'meta.name must be a non-empty string',
      'meta.description must be a non-empty string',
      'meta.phases[1] must be an object',
    )
  })
})
