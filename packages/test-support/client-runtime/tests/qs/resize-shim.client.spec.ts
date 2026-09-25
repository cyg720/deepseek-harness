// @vitest-environment jsdom
/** 无浏览器布局引擎时，测试运行器提供可挂载与释放的观察器，并恢复全局状态。 */
import { expect, it } from 'vitest'
import { RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { TestClient, remoteDefaultResponses, webApp } from '../../src/assembly/index.ts'

it('缺失的 ResizeObserver 支持布局消费者挂载和释放，最后一个运行器释放后移除', async () => {
  expect(globalThis.ResizeObserver).toBeUndefined()
  const roster = webApp.closure(['@deepseek-ai/dsh-api-gateway'])
  const client = await TestClient.start({ roster }, RemoteMock.create().load(remoteDefaultResponses))
  try {
    const calls: ResizeObserverEntry[][] = []
    const observer = new ResizeObserver((entries) => { calls.push(entries) })
    // jsdom 替身仅保障消费者的生命周期，不能伪造实际尺寸通知。
    observer.observe(document.body)
    observer.disconnect()
    expect(calls).toEqual([])
  } finally { await client.dispose() }
  expect(globalThis.ResizeObserver).toBeUndefined()
})
