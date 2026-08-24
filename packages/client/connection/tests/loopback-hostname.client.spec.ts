/** Shared loopback-hostname semantics for the Host fence and browser UI. */
/**
 * 文件职责：验证宿主安全围栏和浏览器界面共享的回环主机名判断规则。
 * 技术维度：使用 Vitest 表驱动循环覆盖 localhost、IPv4 127/8 和带括号 IPv6。
 * 产品维度：确保本地专用功能只在真实回环地址上启用，不被相似远端域名绕过。
 * 逻辑维度：一组合法样本必须返回 true，另一组畸形或非回环样本必须返回 false。
 * 关键边界：输入是 WHATWG URL 已规范化的 hostname，因此 IPv6 回环保留方括号。
 * 新手阅读建议：先比较接受与拒绝样本，再阅读实现中 IPv4 分段数量和数值范围检查。
 */

import { describe, expect, it } from 'vitest'
import { isLoopbackHostname } from '../src/loopback-hostname.ts'

// 测试组：覆盖 isLoopbackHostname 的允许与拒绝样本。
describe('isLoopbackHostname', () => {
  /**
   * 功能描述：确认 localhost、IPv6 回环和整个 IPv4 127/8 范围被接受。
   * 参数说明：测试回调不接收参数；hostname 是当前合法样本字符串。
   * 返回值解释：无返回值；任一样本不为 true 时由 Vitest 报错。
   * 使用示例：127.8.9.10 属于 127/8，应返回 true。
   */
  it('accepts localhost, IPv6 loopback, and the whole IPv4 127/8 block', () => {
    // hostname：当前遍历的规范化合法回环主机名。
    for (const hostname of ['localhost', '[::1]', '127.0.0.1', '127.8.9.10', '127.255.255.255']) {
      expect(isLoopbackHostname(hostname)).toBe(true)
    }
  })

  /**
   * 功能描述：确认相似域名、裸 IPv6 和畸形或非 127/8 IPv4 被拒绝。
   * 参数说明：测试回调不接收参数；hostname 是当前拒绝样本字符串。
   * 返回值解释：无返回值；任一样本不为 false 时由 Vitest 报错。
   * 使用示例：remote.localhost 不是精确 localhost，应返回 false。
   */
  it('refuses malformed and non-loopback hostnames', () => {
    // hostname：当前遍历的非回环或格式无效主机名。
    for (const hostname of ['remote.localhost', '::1', '128.0.0.1', '127.0.0', '127.0.0.256', '127.0.0.-1']) {
      expect(isLoopbackHostname(hostname)).toBe(false)
    }
  })
})
