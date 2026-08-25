/**
 * Stylesheets enter client bundles through virtual modules, so the loader must
 * register their physical files as watch dependencies.
 */
/**
 * 文件职责：验证 client-bundle-css.spec.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clientBundle } from '../packages/client/tsdown.client.ts'

/** 中文说明：interface CssPlugin 定义本测试所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface CssPlugin {
  name: string
  resolveId?: (source: string, importer?: string) => string | null
  load?: (this: { addWatchFile(id: string): void }, id: string) => Promise<string | null>
}

/** 中文说明：函数 cssPlugin 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function cssPlugin(name: 'dsh-css-modules-inline' | 'dsh-css-global-inline' | 'dsh-css-text-inline'): CssPlugin {
  /** 中文说明：变量 configs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configs = clientBundle(
    '@deepseek-ai/dsh-client-test',
    ['lib/types/index.js', 'lib/types/invariant.js'],
  )({ env: { DSH_BUILD_FACE: 'client' } })
  /** 中文说明：函数值 client 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const client = configs.find(config => config.platform === 'browser')
  if (client === undefined) throw new Error('client config missing')
  /** 中文说明：变量 plugins 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const plugins = (client as { plugins: CssPlugin[] }).plugins
  /** 中文说明：函数值 plugin 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const plugin = plugins.find(candidate => candidate.name === name)
  if (plugin === undefined) throw new Error(`${name} missing from client config`)
  return plugin
}

describe('client bundle CSS Modules', () => {
  it('registers the source stylesheet as a watch dependency', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-css-watch-'))
    try {
      /** 中文说明：变量 stylesheet 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const stylesheet = join(root, 'Fixture.module.css')
      /** 中文说明：变量 importer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const importer = join(root, 'index.ts')
      await writeFile(stylesheet, '.root { color: red; }\n')
      /** 中文说明：变量 plugin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const plugin = cssPlugin('dsh-css-modules-inline')
      /** 中文说明：变量 virtualId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const virtualId = plugin.resolveId?.('./Fixture.module.css', importer)
      if (typeof virtualId !== 'string' || plugin.load === undefined) {
        throw new Error('CSS Modules plugin hooks are incomplete')
      }
      /** 中文说明：变量 watched 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const watched: string[] = []

      /** 中文说明：函数值 output 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

      expect(watched).toEqual([stylesheet])
      expect(output).toContain('data-plugin-css')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('client bundle global CSS', () => {
  it('compiles a side-effect stylesheet into a watched style injector', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-global-css-watch-'))
    try {
      /** 中文说明：变量 stylesheet 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const stylesheet = join(root, 'base.css')
      /** 中文说明：变量 importer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const importer = join(root, 'index.ts')
      await writeFile(stylesheet, 'body { color: red; }\n')
      /** 中文说明：变量 plugin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const plugin = cssPlugin('dsh-css-global-inline')
      /** 中文说明：变量 virtualId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const virtualId = plugin.resolveId?.('./base.css', importer)
      if (typeof virtualId !== 'string' || plugin.load === undefined) {
        throw new Error('global CSS plugin hooks are incomplete')
      }
      /** 中文说明：变量 watched 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const watched: string[] = []

      /** 中文说明：函数值 output 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

      expect(watched).toEqual([stylesheet])
      expect(output).toContain('data-plugin-css')
      expect(output).toContain('body{color:red}')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('compiles inline stylesheets as watched text without a module side effect', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-client-inline-css-watch-'))
    try {
      /** 中文说明：变量 stylesheet 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const stylesheet = join(root, 'base.css')
      /** 中文说明：变量 importer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const importer = join(root, 'index.ts')
      await writeFile(stylesheet, 'body { color: red; }\n')
      /** 中文说明：变量 plugin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const plugin = cssPlugin('dsh-css-text-inline')
      /** 中文说明：变量 virtualId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const virtualId = plugin.resolveId?.('./base.css?inline', importer)
      if (typeof virtualId !== 'string' || plugin.load === undefined) {
        throw new Error('inline CSS plugin hooks are incomplete')
      }
      /** 中文说明：变量 watched 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const watched: string[] = []

      /** 中文说明：函数值 output 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

      expect(watched).toEqual([stylesheet])
      expect(output).toContain('export default "body{color:red}"')
      expect(output).not.toContain('data-plugin-css')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
