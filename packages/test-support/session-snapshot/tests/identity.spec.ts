/**
 * 文件职责：验证 test-support/session-snapshot 中 identity spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { redactSessionSnapshotIds } from '../src/identity.ts'

/**
 * 常量说明：parentId 用于处理 parentId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const parentId = '11111111-1111-4111-8111-111111111111'
/**
 * 常量说明：childId 用于处理 childId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const childId = '22222222-2222-4222-8222-222222222222'
/**
 * 常量说明：messageId 用于处理 messageId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const messageId = '33333333-3333-4333-8333-333333333333'
/**
 * 常量说明：approvalId 用于处理 approvalId 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const approvalId = '44444444-4444-4444-8444-444444444444'
/**
 * 常量说明：runId 用于执行 Id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const runId = '55555555-5555-4555-8555-555555555555'
/**
 * 常量说明：otherId 用于处理 otherId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const otherId = '66666666-6666-4666-8666-666666666666'
/**
 * 常量说明：proseUuid 用于处理 proseUuid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const proseUuid = '77777777-7777-4777-8777-777777777777'

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('session snapshot identity redaction', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves typed relationships across parent and child logs', () => {
    /**
     * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parent = [
      JSON.stringify({ type: 'session', id: parentId, createdAt: 1, cwd: '/tmp/work' }),
      JSON.stringify({
        type: 'agent/inbox/spliced',
        data: {
          inserted: [{
            role: 'user',
            content: [{ type: 'text', text: `keep unrelated ${proseUuid}; session ${childId}` }],
            source: { kind: 'user' },
            id: messageId,
          }],
        },
      }),
      JSON.stringify({ type: 'approval/asked', data: { id: approvalId } }),
      JSON.stringify({ type: 'tool-workflow/run-start', data: { runId } }),
      JSON.stringify({ type: 'example', data: { requestId: otherId, echoed: otherId } }),
      '',
    ].join('\n')
    /**
     * 常量说明：child 用于处理 child 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const child = [
      JSON.stringify({ type: 'session', id: childId, parentSession: parentId, createdAt: 2, cwd: '/tmp/work' }),
      JSON.stringify({
        type: 'user/message',
        data: {
          role: 'user', content: [], source: { kind: 'user' }, id: messageId,
        },
      }),
      '',
    ].join('\n')

    /**
     * 常量说明：redacted 用于处理 redacted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const redacted = redactSessionSnapshotIds([parent, child])
    expect(redacted[0]).toContain('"id":"{{session:1}}"')
    expect(redacted[1]).toContain('"id":"{{session:2}}"')
    expect(redacted[1]).toContain('"parentSession":"{{session:1}}"')
    expect(redacted.join('\n').match(/\{\{message:1\}\}/g)).toHaveLength(2)
    expect(redacted[0]).toContain('"id":"{{approval:1}}"')
    expect(redacted[0]).toContain('"runId":"{{workflow:1}}"')
    expect(redacted[0]).toContain('"requestId":"{{id:1}}"')
    expect(redacted[0]).toContain('"echoed":"{{id:1}}"')
    expect(redacted[0]).toContain(proseUuid)
    expect(redacted[0]).toContain('session {{session:2}}')
    expect(redactSessionSnapshotIds(redacted)).toEqual(redacted)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('classifies semantic text plus command, RPC, and retry identity fields', () => {
    /**
     * 常量说明：semanticMessage 用于处理 semanticMessage 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const semanticMessage = '88888888-8888-4888-8888-888888888888'
    /**
     * 常量说明：anonymousUser 用于处理 anonymousUser 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const anonymousUser = '99999999-9999-4999-8999-999999999999'
    /**
     * 常量说明：retryId 用于处理 retryId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const retryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = [
      JSON.stringify({ type: 'not-a-session', data: { value: 'plain' } }),
      JSON.stringify({
        type: 'example',
        data: {
          commandId: 'command-7',
          rpcId: 'rpc-9',
          retryId,
          requestId: 'stable-readable-id',
          text: `Retain this as message ${semanticMessage}. Anonymous user: ${anonymousUser}`,
        },
      }),
    ].join('\n')

    /**
     * 常量说明：redacted 用于处理 redacted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const [redacted] = redactSessionSnapshotIds([source])
    expect(redacted).toContain('"commandId":"{{command:1}}"')
    expect(redacted).toContain('"rpcId":"{{rpc:1}}"')
    expect(redacted).toContain('"retryId":"{{retry:1}}"')
    expect(redacted).toContain('as message {{message:1}}')
    expect(redacted).toContain('Anonymous user: {{id:1}}')
    expect(redacted).toContain('"requestId":"stable-readable-id"')
    expect(redacted?.endsWith('\n')).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps a canonical token first seen through a generic id key', () => {
    /**
     * 常量说明：canonical 用于处理 canonical 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const canonical = '{{message:7}}'
    /**
     * 常量说明：nextMessage 用于处理 nextMessage 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nextMessage = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = [
      JSON.stringify({ type: 'example', data: { requestId: canonical } }),
      JSON.stringify({
        type: 'user/message',
        data: { role: 'user', content: [], source: { kind: 'user' }, id: canonical },
      }),
      JSON.stringify({
        type: 'user/message',
        data: { role: 'user', content: [], source: { kind: 'user' }, id: nextMessage },
      }),
      '',
    ].join('\n')

    /**
     * 常量说明：redacted 用于处理 redacted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const [redacted] = redactSessionSnapshotIds([source])
    expect(redacted?.match(/\{\{message:7\}\}/g)).toHaveLength(2)
    expect(redacted).toContain('"id":"{{message:8}}"')
    expect(redacted).not.toContain('{{id:')
  })
})
