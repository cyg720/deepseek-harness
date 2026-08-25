/** Node half: the empty host apply (Loader governance + dsh.client discovery placeholder). */
/*
 * 文件职责：验证客户端运行时包的 Node 半边 `apply` 是可安全调用的空占位。
 * 技术维度：使用 Vitest 直接调用插件入口，并以无异常作为可观察结果。
 * 产品维度：Loader 可发现客户端包而不会在主机侧意外启动浏览器逻辑。
 * 逻辑维度：注册一个测试用例，传入 undefined 调用 apply，再确认执行到断言。
 * 关键边界：该测试只证明无副作用且不抛错，不代表浏览器运行时行为。
 * 新手阅读建议：先看唯一用例，再到 src/index.ts 理解为何保留空 Node 半边。
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

/** Node 半边测试套件；运行 `pnpm run test:gui` 时由 Vitest 自动调用回调。 */
describe('node half', () => {
  /** 调用空占位并验证没有抛错；回调无参数、无返回值。 */
  it('apply is a no-op host placeholder', () => {
    apply(undefined)
    expect(true).toBe(true) // reaching here without throw is the contract
    // 能执行到此断言即说明占位入口没有抛出异常。
  })
})
