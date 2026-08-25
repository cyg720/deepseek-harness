/** The Remote face delegates to the provider's discovery contract unchanged. */
/*
 * 文件职责：验证文件引用服务的 Remote 接口原样委托具体提供者的发现方法。
 * 技术维度：使用 Vitest 模拟函数、抽象类测试子类、AbortSignal 和对象身份断言。
 * 产品维度：保证远端客户端获得提供者真实候选列表，不被服务门面改写或复制。
 * 逻辑维度：创建候选与 list 模拟，定义最小提供者，调用 remoteExportList，再检查结果和参数。
 * 关键边界：测试只覆盖委托语义；不访问真实文件系统，也不验证查询排序。
 * 新手阅读建议：先看 StubProvider 如何实现抽象 list，再比较调用参数和返回 candidates 的同一性。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FileReferenceService } from '../src/index.ts'
import type { FileReferenceCandidate } from '../src/types.ts'

// 测试组：描述 FileReferenceService 的 Remote 导出委托行为。
describe('FileReferenceService', () => {
  /**
   * 功能描述：确认 remoteExportList 把 agent、query、signal 原样交给 list 并返回同一数组。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；委托参数或对象身份不符时由 Vitest 报错。
   * 使用示例：查询 sr 应把提供者返回的 src 目录候选原样交付。
   */
  it('serves the Remote face through the abstract discovery member', async () => {
    // candidates：提供者模拟返回的单个目录候选数组。
    const candidates: FileReferenceCandidate[] = [{ path: 'src', kind: 'directory' }]
    // list：记录三个委托参数并解析为 candidates 的抽象发现方法替身。
    const list = vi.fn((_agent: Agent, _query: string, _signal: AbortSignal) => Promise.resolve(candidates))
    // StubProvider：仅为测试实现抽象 list 成员的最小具体服务类。
    class StubProvider extends FileReferenceService {
      list = list
    }
    // provider：绑定独立 Cordis 上下文的测试提供者实例。
    const provider = new StubProvider(new Context())
    // agent：只需稳定身份的最小代理替身。
    const agent = { id: 'target' } as unknown as Agent
    // signal：传给发现调用的未中止信号。
    const signal = new AbortController().signal
    await expect(provider.remoteExportList(agent, 'sr', signal)).resolves.toBe(candidates)
    expect(list).toHaveBeenCalledWith(agent, 'sr', signal)
  })
})
