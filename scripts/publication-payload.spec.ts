/**
 * 文件职责：验证 publication-payload.spec.ts 覆盖的发布、门禁、翻译配对或仓库维护职责。
 * 技术维度：使用 TypeScript、Vitest、Node.js 文件系统、Git、包管理器或构建产物校验。
 * 产品维度：保障项目发布物、文档配对和 CI 门禁保持一致且可追踪。
 * 逻辑维度：解析参数与仓库状态，执行检查或发布步骤，再输出诊断和退出状态。
 * 关键边界：发布与 Git 操作会改变外部状态；失败必须显式停止；路径和命令输出不可信。
 * 新手阅读建议：先看入口参数和只读检查，再读状态变更步骤，最后关注回滚、错误码和平台差异。
 */
import { describe, expect, it } from 'vitest'
import {
  hasTypertRemoteNavigation,
  isForbiddenPublicationFile,
  validateTarballPayload,
} from './publication-payload.ts'

/** 中文说明：函数 validateFixtureTarball 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function validateFixtureTarball(files: readonly string[]): () => void {
  return () => {
    validateTarballPayload(files, 'fixture.tgz')
  }
}

describe('publication payload policy', () => {
  it.each([
    'lib/index.js',
    'lib/types/index.d.ts',
    'lib/styles/base.css',
  ])('accepts %s', (file) => {
    expect(isForbiddenPublicationFile(file)).toBe(false)
  })

  it.each([
    'src',
    './src',
    'src/',
    'src/index.ts',
    './src/index.ts',
    String.raw`src\index.ts`,
    'lib/types/index.d.ts.map',
    './lib/types/index.d.ts.map',
    'lib/typert.remote-client.d.ts.map',
    'lib/client.js.map',
    './lib/client.js.map',
  ])('rejects static manifest path %s', (file) => {
    expect(isForbiddenPublicationFile(file)).toBe(true)
  })

  it('rejects source members in packed tarballs', () => {
    expect(validateFixtureTarball([
      'package/package.json',
      'package/src/index.ts',
    ])).toThrow('fixture.tgz publishes source file package/src/index.ts')
  })

  it('rejects source maps in packed tarballs', () => {
    expect(validateFixtureTarball([
      'package/package.json',
      'package/lib/types/index.d.ts.map',
    ])).toThrow('fixture.tgz publishes source map package/lib/types/index.d.ts.map')
    expect(validateFixtureTarball([
      'package/package.json',
      'package/lib/typert.remote-client.d.ts.map',
    ])).toThrow('fixture.tgz publishes source map package/lib/typert.remote-client.d.ts.map')
    expect(validateFixtureTarball([
      'package/package.json',
      'package/lib/client.js.map',
    ])).toThrow('fixture.tgz publishes source map package/lib/client.js.map')
  })

  it('accepts a clean packed tarball', () => {
    expect(validateFixtureTarball([
      'package/package.json',
      'package/lib/index.js',
      'package/lib/types/index.d.ts',
      'package/lib/styles/base.css',
    ])).not.toThrow()
  })

  it('recognizes only the canonical Host-for-Client export pair', () => {
    expect(hasTypertRemoteNavigation({
      exports: {
        './remote': {
          types: './lib/typert.remote-client.d.ts',
          default: './lib/typert.remote-client.js',
        },
      },
    })).toBe(true)
    expect(hasTypertRemoteNavigation({ exports: { './remote': './lib/remote.js' } })).toBe(false)
  })
})
