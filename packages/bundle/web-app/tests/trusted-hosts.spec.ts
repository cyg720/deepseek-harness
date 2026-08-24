/** Single-sample LAN-trust resolution for the /api browser-trust fence (`resolveLanTrust`). */
/**
 * 文件职责：验证 Web API 浏览器信任围栏从一次网卡快照解析局域网地址和可信主机。
 * 技术维度：使用 Vitest 模块模拟 node:os.networkInterfaces，覆盖 IPv4、IPv6、回环和缺失接口。
 * 产品维度：让局域网部署可展示并信任正确地址，同时避免回环绑定意外扩展信任范围。
 * 逻辑维度：固定网卡样本后，分别验证全接口绑定的地址合并与回环绑定的空派生结果。
 * 关键边界：只采样非内部 IPv4；额外主机仅在规则允许时加入，IPv6 不进入当前 LAN 列表。
 * 新手阅读建议：先看 vi.mock 的四类接口，再比较两个绑定地址对应的期望结果。
 */

import { describe, expect, it, vi } from 'vitest'
import { resolveLanTrust } from '../src/index.ts'

// 模拟操作系统网卡枚举；回调无参数，返回固定的一次网络接口快照。
vi.mock('node:os', () => ({
  networkInterfaces: () => ({
    lo0: [
      { family: 'IPv4', internal: true, address: '127.0.0.1' },
    ],
    en0: [
      { family: 'IPv6', internal: false, address: 'fe80::1' },
      { family: 'IPv4', internal: false, address: '192.168.1.5' },
    ],
    en1: [
      { family: 'IPv4', internal: false, address: '10.0.0.7' },
    ],
    utun0: undefined,
  }),
}))

// 局域网信任解析测试套件。
describe('resolveLanTrust', () => {
  // 验证 0.0.0.0 绑定采集非内部 IPv4 并追加显式可信主机。
  it('samples non-internal IPv4 addresses once for an all-interfaces bind: trust and display share them', () => {
    // 展示地址和最终可信主机；两者共享相同 LAN 采样。
    const { lanAddresses, trustedHosts } = resolveLanTrust('0.0.0.0', ['harness.internal:3080'])
    expect(lanAddresses).toEqual(['192.168.1.5', '10.0.0.7'])
    expect(trustedHosts).toEqual(['192.168.1.5', '10.0.0.7', 'harness.internal:3080'])
  })

  // 验证回环绑定不派生 LAN 地址，显式额外主机按原值保留。
  it('derives nothing for a loopback bind — extras alone stand, no LAN URL to print', () => {
    expect(resolveLanTrust('127.0.0.1', [])).toEqual({ lanAddresses: [], trustedHosts: [] })
    expect(resolveLanTrust('127.0.0.1', ['lab.internal']))
      .toEqual({ lanAddresses: [], trustedHosts: ['lab.internal'] })
  })
})
