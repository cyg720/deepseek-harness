/**
 * 文件职责：验证 Oxlint 启动参数解析保持默认行为、限制线程、选择 CI 格式并拒绝冲突配置。
 * 技术维度：使用 Vitest 参数化测试直接检查 args/env 纯数据结果。
 * 产品维度：让本地与 CI lint 稳定占用受控资源，并保留可定位诊断。
 * 逻辑维度：覆盖默认、线程上限、CI、显式格式、非法线程值和重复线程参数六类路径。
 * 关键边界：DSH_OXLINT_THREADS 必须为正整数；设置它时不能再传 --threads。
 * 新手阅读建议：先比较每例输入与 args/env 输出，再看最后两例的拒绝条件。
 */
import { describe, expect, it } from 'vitest'
import { resolveOxlintInvocation } from './run-oxlint.ts'

// Oxlint 调用解析测试套件。
describe('Oxlint invocation', () => {
  // 验证未设置特殊环境时原样保留参数和环境。
  it('preserves the ordinary default invocation', () => {
    expect(resolveOxlintInvocation(['.'], { PATH: '/bin' })).toEqual({
      args: ['.'],
      env: { PATH: '/bin' },
    })
  })

  // 验证单个设置同时限制 Oxlint 与 Go 运行时线程池。
  it('bounds both worker pools from one setting', () => {
    expect(resolveOxlintInvocation(['.', '--fix'], { DSH_OXLINT_THREADS: '4', GOMAXPROCS: '12' })).toEqual({
      args: ['.', '--fix', '--threads=4'],
      env: { DSH_OXLINT_THREADS: '4', GOMAXPROCS: '4' },
    })
  })

  // 验证 CI 自动使用 unix 格式并保留线程限制。
  it('uses location-preserving diagnostics in CI', () => {
    expect(resolveOxlintInvocation(['.'], { CI: 'true', DSH_OXLINT_THREADS: '4' })).toEqual({
      args: ['.', '--format=default', '--threads=4'],
      env: { CI: 'true', DSH_OXLINT_THREADS: '4', GOMAXPROCS: '4' },
    })
  })

  // 验证调用方显式格式不会被 CI 默认覆盖。
  it('preserves an explicitly selected CI formatter', () => {
    expect(resolveOxlintInvocation(['.', '--format', 'github'], { CI: 'true' }).args)
      .toEqual(['.', '--format', 'github'])
  })

  // 参数化非法线程值；value 必须被拒绝并显示统一诊断。
  it.each(['0', '-1', '1.5', 'auto'])('rejects invalid worker bound %s', (value) => {
    expect(() => resolveOxlintInvocation(['.'], { DSH_OXLINT_THREADS: value }))
      .toThrow('DSH_OXLINT_THREADS must be a positive integer')
  })

  // 验证环境线程设置与直接 --threads 参数不能同时出现。
  it('rejects a competing direct worker bound', () => {
    expect(() => resolveOxlintInvocation(['.', '--threads=2'], { DSH_OXLINT_THREADS: '4' }))
      .toThrow('use DSH_OXLINT_THREADS instead')
  })
})
