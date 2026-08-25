/**
 * Pins shared client-bundle preset rules: the module-edge purity gate and
 * the physical watch dependencies hidden behind virtual CSS Modules.
 */
/**
 * 文件职责：验证 client-bundle-purity.spec.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { clientBundle, requestedExternals } from '../packages/client/tsdown.client.ts'

/** 中文说明：type ResolveId 定义本测试所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
type ResolveId = (source: string) => null | { id: string; external: boolean }

/** 中文说明：interface CssModulePlugin 定义本测试所需的数据或行为，用于表达仓库构建、校验或维护脚本场景。 */
interface CssModulePlugin {
  name: string
  resolveId?: (source: string, importer: string | undefined) => null | string
  load?: (this: { addWatchFile: (id: string) => void }, id: string) => Promise<unknown>
}

/** A representative dynamic bundle using the shared client baseline. */
/** 中文说明：常量 REQUESTING_PACKAGE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const REQUESTING_PACKAGE = '@deepseek-ai/dsh-client-ui-conversation'

/** 中文说明：函数 clientConfigs 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function clientConfigs(id = REQUESTING_PACKAGE) {
  return clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'])(
    { env: { DSH_BUILD_FACE: 'client' } },
  ).filter(config => config.platform === 'browser')
}

describe('client bundle build faces', () => {
  it('watches source in development and consumes emitted JavaScript in the Client build', () => {
    /** 中文说明：变量 bundle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundle = clientBundle('@deepseek-ai/dsh-client-test', ['lib/types/index.js'])
    /** 中文说明：函数值 development 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const development = bundle({ env: {} }).find(config => config.platform === 'browser')
    /** 中文说明：变量 artifact 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const artifact = bundle({ env: { DSH_BUILD_FACE: 'client' } })
      .find(config => config.platform === 'browser')

    expect(development?.entry).toEqual({ client: 'src/client/index.ts' })
    expect(artifact?.entry).toEqual({ client: 'lib/types/client/index.js' })
  })
})

/** 中文说明：函数 clientSourceMapPath 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function clientSourceMapPath(packagePath: string): string {
  return fileURLToPath(new URL(`../packages/${packagePath}/lib/client.js.map`, import.meta.url))
}

/** 中文说明：函数 purityResolveId 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function purityResolveId(id = REQUESTING_PACKAGE): ResolveId {
  // libEntry is spelled at every call site (no default) so the
  // package-invariants text check can see the invariant entry per package.
  /** 中文说明：变量 configs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configs = clientConfigs(id)
  /** 中文说明：变量 plugins 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const plugins = (configs[0] as { plugins: { name: string; resolveId?: unknown }[] }).plugins
  /** 中文说明：函数值 gate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const gate = plugins.find(p => p.name === 'dsh-client-bundle-purity')
  if (gate?.resolveId === undefined) throw new Error('purity plugin missing from client config')
  return gate.resolveId as ResolveId
}

/** 中文说明：函数 cssModulePlugin 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function cssModulePlugin(): CssModulePlugin {
  /** 中文说明：变量 configs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configs = clientConfigs()
  /** 中文说明：变量 plugins 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const plugins = (configs[0] as { plugins: CssModulePlugin[] }).plugins
  /** 中文说明：函数值 plugin 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const plugin = plugins.find(candidate => candidate.name === 'dsh-css-modules-inline')
  if (plugin?.resolveId === undefined || plugin.load === undefined) {
    throw new Error('CSS Modules plugin missing from client config')
  }
  return plugin
}

describe('client bundle purity gate', () => {
  /** 中文说明：变量 resolveId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const resolveId = purityResolveId()

  it('leaves default externals and non-scoped specifiers alone', () => {
    expect(resolveId('@deepseek-ai/dsh-client-ui-slots')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-client-ui-primitives')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-client-runtime/client')).toBeNull()
    expect(resolveId('react')).toBeNull()
    expect(resolveId('zod')).toBeNull()
  })

  it('rejects the retired web-react platform package', () => {
    expect(() => resolveId('@deepseek-ai/dsh-client-web-react')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-web-react/store')).toThrow(/purity/)
  })

  it('lets inline-safe wire layers inline', () => {
    expect(resolveId('@deepseek-ai/dsh-host-apiproxy/api')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-session/surface')).toBeNull()
    expect(resolveId('@deepseek-ai/dsh-brand')).toBeNull()
  })

  it('lets exact generated Remote contributions inline without admitting their package implementation', () => {
    expect(resolveId('@deepseek-ai/dsh-goal/remote')).toBeNull()
    expect(() => resolveId('@deepseek-ai/dsh-goal')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-goal/client')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-goal/remote/nested')).toThrow(/purity/)
  })

  it('throws on any other @deepseek-ai leak', () => {
    expect(() => resolveId('@deepseek-ai/dsh-agent')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-web')).toThrow(/purity/)
  })

  it('throws on cross-plugin value imports — bare plugin names and /client subpaths alike', () => {
    expect(() => resolveId('@deepseek-ai/dsh-client-connection')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-runtime')).toThrow(/purity/)
    expect(() => resolveId('@deepseek-ai/dsh-client-ui-layout/client')).toThrow(/purity/)
  })

  it('admits the parser-preloaded runtime for every dynamic bundle', () => {
    expect(resolveId('@deepseek-ai/dsh-client-runtime/client')).toBeNull()
    /** 中文说明：变量 withoutRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const withoutRequest = purityResolveId('@deepseek-ai/dsh-client-ui-goal')
    expect(withoutRequest('@deepseek-ai/dsh-client-runtime/client')).toBeNull()
  })

  it('externalizes the baseline independently of each package manifest', () => {
    /** 中文说明：函数值 requesting 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const requesting = clientConfigs()[0]?.deps as { neverBundle: (specifier: string) => boolean }
    /** 中文说明：变量 plain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plain = clientConfigs('@deepseek-ai/dsh-client-connection')[0]?.deps as {
      neverBundle: (specifier: string) => boolean
    }

    expect(requesting.neverBundle('react')).toBe(true)
    expect(requesting.neverBundle('zod')).toBe(false)
    expect(plain.neverBundle('react')).toBe(true)
    expect(plain.neverBundle('@deepseek-ai/dsh-client-runtime/client')).toBe(true)
  })
})

describe('client bundle module requests', () => {
  it('requests what the declaration lists', () => {
    /** 中文说明：变量 requests 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const requests = requestedExternals('@deepseek-ai/dsh-client-fixture', {
      external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-slots'],
    })

    expect([...requests].sort()).toEqual([
      '@deepseek-ai/dsh-client-ui-slots', 'react', 'react/jsx-runtime',
    ])
  })

  it('requests nothing when the declaration is absent', () => {
    expect(requestedExternals('@deepseek-ai/dsh-client-fixture', {}).size).toBe(0)
  })

  it('rejects a malformed declaration instead of reading past it', () => {
    expect(() => requestedExternals('@deepseek-ai/dsh-client-fixture', { external: 'react' }))
      .toThrow(/dsh\.client\.external must be a string array/)
  })
})

describe('client bundle debug artifacts', () => {
  it('emits source maps for plugin TS and TSX outside the Vite module graph', () => {
    /** 中文说明：变量 configs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configs = clientConfigs()
    expect(configs[0]?.sourcemap).toBe(true)
  })

  it('maps first-party sources to their repository package paths', () => {
    /** 中文说明：变量 configs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configs = clientConfigs('@deepseek-ai/dsh-client-ui-goal')
    /** 中文说明：变量 outputOptions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    /** 中文说明：变量 transform 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = transform('../src/client/GoalBar.tsx', clientSourceMapPath('client/ui-goal'))
    expect(source).toBe('../../../packages/client/ui-goal/src/client/GoalBar.tsx')
    /** 中文说明：变量 resolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = new URL(source, 'https://dsh.test/plugins/@deepseek-ai/dsh-client-ui-goal/client.js.map')
    expect(resolved.pathname).toBe('/packages/client/ui-goal/src/client/GoalBar.tsx')
  })

  it('maps dual-face host sources to the host package group', () => {
    /** 中文说明：变量 configs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configs = clientConfigs('@deepseek-ai/dsh-host-directory-picker-native')
    /** 中文说明：变量 outputOptions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    /** 中文说明：变量 transform 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = transform('../src/client/index.ts', clientSourceMapPath('host/directory-picker-native'))
    expect(source).toBe('../../../packages/host/directory-picker-native/src/client/index.ts')
  })

  it('maps inlined workspace sources to packages and leaves dependencies outside it unchanged', () => {
    /** 中文说明：变量 configs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configs = clientConfigs('@deepseek-ai/dsh-client-connection')
    /** 中文说明：变量 outputOptions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    /** 中文说明：变量 transform 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    /** 中文说明：变量 sourceMapPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sourceMapPath = clientSourceMapPath('client/connection')
    /** 中文说明：变量 workspaceSource 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workspaceSource = transform('../../../host/apiproxy/src/api/rpc.ts', sourceMapPath)
    expect(workspaceSource).toBe('../../../packages/host/apiproxy/src/api/rpc.ts')
    /** 中文说明：变量 resolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = new URL(workspaceSource, 'https://dsh.test/plugins/@deepseek-ai/dsh-client-connection/client.js.map')
    expect(resolved.pathname).toBe('/packages/host/apiproxy/src/api/rpc.ts')

    /** 中文说明：变量 dependencySource 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dependencySource = '../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js'
    expect(transform(dependencySource, sourceMapPath)).toBe(dependencySource)
  })
})

describe('client bundle CSS Modules watch graph', () => {
  it('registers the physical stylesheet read behind a virtual module', async () => {
    /** 中文说明：变量 plugin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plugin = cssModulePlugin()
    /** 中文说明：变量 importer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const importer = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/queue/QueueDock.tsx',
      import.meta.url,
    ))
    /** 中文说明：变量 stylesheet 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stylesheet = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/queue/QueueDock.module.css',
      import.meta.url,
    ))
    /** 中文说明：变量 virtualId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const virtualId = plugin.resolveId?.('./QueueDock.module.css', importer)
    if (virtualId === null || virtualId === undefined) throw new Error('CSS Modules import was not resolved')
    /** 中文说明：变量 addWatchFile 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const addWatchFile = vi.fn()

    await plugin.load?.call({ addWatchFile }, virtualId)

    expect(addWatchFile).toHaveBeenCalledExactlyOnceWith(stylesheet)
  })
})
