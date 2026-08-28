/** The abstract service preserves the provider's discovery contract. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FileReferenceService } from '../src/index.ts'
import type { FileReferenceCandidate } from '../src/types.ts'

// 测试组：描述 FileReferenceService 的 Remote 导出委托行为。
describe('FileReferenceService', () => {
  it('registers a provider implementation without wrapping its discovery member', async () => {
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
    await expect(provider.list(agent, 'sr', signal)).resolves.toBe(candidates)
    expect(list).toHaveBeenCalledWith(agent, 'sr', signal)
  })
})
