// Shared scaffolding for the assembled-jsdom snapshots: the real built
// workspace `lib/client.js` artifacts booted through AppWebEntry's
// ModuleLoader path (loadBundle) against the keyless FixtureApiClient
// transport. Every file that mounts this graph needs the same boot entry list,
// the same bundle map, the same jsdom globals, and the same mount call, and
// differs only in what it asserts afterwards, so the scaffolding lives here.
//
// Keyless and deterministic: the fixture is the fake server, so nothing here
// reaches a model or the network.
// fixture 充当假服务器，因此整个装配过程不访问模型或网络。
/**
 * 文件职责：为基于 jsdom 的客户端快照测试组装真实构建插件图和确定性 Fixture API。
 * 技术维度：使用包清单解析、模块依赖排序、动态 eval、Testing Library 与 jsdom 全局桩。
 * 产品维度：在无网络条件下验证发布客户端插件能按真实 Web 启动顺序装配和渲染。
 * 逻辑维度：从 bundle 补丁发现客户端包，读取构建代码，安装测试环境，再注入加载器并挂载应用。
 * 关键边界：依赖已构建 lib/client.js；每个用例后必须清理 DOM、全局对象、样式和应用实例。
 * 新手阅读建议：先看 loadAssembledPlugins 如何发现插件，再读环境安装与 mountAssembledApp。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { bootInjections, orderByModuleGraph } from '@deepseek-ai/dsh-client-modules'
import type { ClientModuleLoaderTarget, WebBootEntry } from '@deepseek-ai/dsh-client-modules/client'
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

/** 带构建产物绝对路径的 Web 启动插件记录。 */
interface AssembledPlugin extends WebBootEntry {
  /** Absolute path to the built client artifact declared by this package. */
  /** 包清单声明的构建客户端入口绝对路径。 */
  bundlePath: string
}

/** 测试从客户端包 package.json 中读取的字段。 */
interface ClientPackageManifest {
  name?: string
  exports?: Record<string, string | { default?: string }>
  dsh?: {
    client?: {
      platform?: string
      inject?: string[]
      external?: string[]
      immediately?: boolean
    }
  }
}

/** 组合后只需检查名称与禁用状态的配置行。 */
interface ComposedEntry {
  name?: unknown
  disabled?: unknown
}

/** 动态导入 app-boot 后使用的最小组合接口。 */
interface BootComposition {
  loadOverlayPatches(binName: string, file: string): unknown[]
  composeEntries(layers: readonly unknown[][]): ComposedEntry[]
}

/** 仓库根目录；测试命令要求从仓库根启动。 */
const REPO_ROOT = process.cwd()
/** 发布 Web 配置依次应用的基础与 Web bundle 层。 */
const BUNDLE_LAYERS = [
  {
    manifest: join(REPO_ROOT, 'packages/bundle/base/package.json'),
    patch: join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml'),
  },
  {
    manifest: join(REPO_ROOT, 'packages/bundle/web-app/package.json'),
    patch: join(REPO_ROOT, 'packages/bundle/web-app/cordis.patch.yml'),
  },
] as const
/** 分别以每个 bundle 清单为锚点创建的模块解析器。 */
const bundleResolvers = BUNDLE_LAYERS.map(layer => createRequire(layer.manifest))
/** Web bundle 的模块解析器，用于加载同一安装闭包中的 app-boot。 */
const webBundleResolver = bundleResolvers[1]
if (webBundleResolver === undefined) throw new Error('assembled boot: web bundle resolver missing')
/** 通过 Web bundle 依赖面加载的真实配置组合实现。 */
const appBoot = await import(pathToFileURL(webBundleResolver.resolve('@deepseek-ai/dsh-app-boot')).href) as unknown as BootComposition

/**
 * 从任一 bundle 解析器查找包清单。
 * @param specifier 裸包名。
 * @returns 首个可解析的 package.json 路径，否则为 undefined。
 * @example `resolvePackageManifest('@deepseek-ai/dsh-client-web')`
 */
function resolvePackageManifest(specifier: string): string | undefined {
  for (const require of bundleResolvers) {
    try {
      return require.resolve(`${specifier}/package.json`)
    } catch {
      continue
    }
  }
  return undefined
}

/**
 * 根据包的 ./client 导出解析构建入口。
 * @param packagePath 包清单绝对路径。
 * @param pkg 已解析的包清单。
 * @returns 客户端构建文件绝对路径。
 * @example `resolveClientExport(path, manifest)`
 */
function resolveClientExport(packagePath: string, pkg: ClientPackageManifest): string {
  /** 包清单中 ./client 导出的声明。 */
  const declared = pkg.exports?.['./client']
  /** 字符串导出或条件导出的默认相对路径。 */
  const relative = typeof declared === 'string' ? declared : declared?.default
  if (relative === undefined) {
    throw new Error(`assembled boot: ${pkg.name ?? packagePath} declares dsh.client without a ./client export`)
  }
  return resolve(dirname(packagePath), relative)
}

/** Derive the assembled browser graph from the same bundle patches and package declarations as `dsh web`. */
/** 从与 dsh web 相同的补丁和包声明推导排序后的浏览器插件图。 */
function loadAssembledPlugins(): readonly AssembledPlugin[] {
  /** 两个真实 bundle 层组合后的有效配置行。 */
  const entries = appBoot.composeEntries(BUNDLE_LAYERS.map(layer =>
    appBoot.loadOverlayPatches('assembled boot', layer.patch)))
  /** 按包名去重的 Web 客户端插件。 */
  const plugins = new Map<string, AssembledPlugin>()
  for (const entry of entries) {
    if (entry.disabled === true || typeof entry.name !== 'string') continue
    /** 当前配置包可解析的 package.json。 */
    const packagePath = resolvePackageManifest(entry.name)
    if (packagePath === undefined) continue
    /** 当前配置行对应的包清单。 */
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as ClientPackageManifest
    /** 包声明的客户端平台、依赖和加载时机。 */
    const declaration = pkg.dsh?.client
    if (declaration?.platform !== 'web') continue
    if (pkg.name !== entry.name) {
      throw new Error(`assembled boot: ${entry.name} resolved package ${pkg.name ?? '<unnamed>'}`)
    }
    plugins.set(entry.name, {
      id: entry.name,
      bundlePath: resolveClientExport(packagePath, pkg),
      url: `/plugins/${entry.name}/client.js?rev=fx`,
      rev: 'fx',
      ...(declaration.inject === undefined ? {} : { inject: declaration.inject }),
      ...(declaration.external === undefined ? {} : { external: declaration.external }),
      ...(declaration.immediately === true ? { immediately: true } : {}),
    })
  }
  return orderByModuleGraph([...plugins.values()]).map(({ id }) => {
    /** 依赖排序后编号对应的插件记录。 */
    const plugin = plugins.get(id)
    /* v8 ignore next -- orderByModuleGraph returns the input row identities */
    /* 排序器返回输入行自身，因此编号必然仍在映射中。 */
    if (plugin === undefined) throw new Error(`assembled boot: ordered unknown client package ${id}`)
    return plugin
  })
}

/** 真实发布配置推导出的有序客户端插件表。 */
const PLUGINS = loadAssembledPlugins()

/** 插件 URL 到构建 JavaScript 文本的内存映射，模拟主机静态服务。 */
const bundles = new Map(PLUGINS.map(plugin => [
  plugin.url,
  readFileSync(plugin.bundlePath, 'utf8'),
]))

/** 声明主机注入到浏览器窗口的启动清单和模块加载器。 */
interface FixtureWindow extends Window {
  __DSH_BOOT__?: { rev: string; entries: WebBootEntry[] }
  __ModuleLoader__?: ClientModuleLoaderTarget
}

/** jsdom 缺失的 ResizeObserver 最小无操作实现。 */
class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

/** jsdom 测试不需要真实连接的 EventSource 最小实现。 */
class EventSourceStub {
  addEventListener(): void {}
  close(): void {}
}

/** 带启动注入字段的当前 jsdom 窗口。 */
const win = window as FixtureWindow
/** 当前挂载应用的异步释放函数。 */
let unmount: (() => Promise<void>) | undefined

/**
 * Register the per-test jsdom setup and teardown the assembled boot needs:
 * English pinned before boot so role/text locators stay deterministic across
 * localized component migrations (the newEnglishPage e2e convention), the
 * observers and frame callbacks jsdom lacks, and a full reset of the document,
 * the boot globals, and the injected plugin styles afterwards.
 */
/** 安装装配启动测试共享的 jsdom 初始化与彻底清理钩子。 */
export function installAssembledBootEnv(): void {
  beforeEach(() => {
    localStorage.clear()
    // The locale service derives its provisional locale from the browser and
    // takes an explicit choice only from Host settings, which this lane's
    // fixture transport does not serve; pinning the navigator is what selects
    // English here.
    // fixture 不提供主机设置，因此通过 navigator 语言选择稳定英文界面。
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    document.title = 'DeepSeek Harness'
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('EventSource', EventSourceStub)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => { callback(0) }, 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { clearTimeout(id) })
  })

  afterEach(async () => {
    await act(async () => { await unmount?.() })
    unmount = undefined
    cleanup()
    delete win.__DSH_BOOT__
    delete win.__ModuleLoader__
    document.body.innerHTML = ''
    document.head.querySelectorAll('style[data-plugin]').forEach((style) => { style.remove() })
    document.title = ''
    history.replaceState(null, '', '/')
    // Deleting the own properties uncovers jsdom's own accessors again
    // (Navigator declares both readonly, hence the erased receiver).
    // 删除自有属性后恢复 jsdom 原访问器；类型擦除用于处理 Navigator 的只读声明。
    /** 可删除测试自有语言属性的 navigator 视图。 */
    const ownNavigator = navigator as unknown as Record<string, unknown>
    delete ownNavigator.languages
    delete ownNavigator.language
    vi.unstubAllGlobals()
  })
}

/**
 * Mount the assembled application on the fixture transport; the teardown
 * registered by installAssembledBootEnv disposes it.
 * @param search - fixture query string used to select deterministic host behavior.
 */
/**
 * 在 Fixture 传输上挂载真实装配应用。
 * @param search 选择确定性主机行为的查询字符串。
 * @returns 无返回值；释放由 installAssembledBootEnv 注册的钩子完成。
 * @example `mountAssembledApp('?fixture')`
 */
export function mountAssembledApp(search = '?fixture'): void {
  history.replaceState(null, '', `/${search}`)
  /** React 应用挂载的根元素。 */
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  win.__DSH_BOOT__ = { rev: 'fx', entries: PLUGINS.map(({ bundlePath: _bundlePath, ...plugin }) => plugin) }
  /** 主机注入脚本中负责安装 ModuleLoader 外观的首行。 */
  const [facadeRow] = bootInjections(win.__DSH_BOOT__)
  if (facadeRow?.kind !== 'script') throw new Error('missing injected ModuleLoader facade row')
  ;(0, eval)(facadeRow.text)
  // Mirror the blocking Host-injected scripts before the Vite entry calls create().
  // 在 Vite 入口 create 之前模拟主机同步注入的两个基础脚本。
  for (const id of ['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-runtime']) {
    /** 当前预加载基础插件记录。 */
    const plugin = PLUGINS.find(candidate => candidate.id === id)
    if (plugin === undefined) throw new Error(`missing parser-preloaded fixture row ${id}`)
    /** 当前插件的构建代码文本。 */
    const code = bundles.get(plugin.url)
    if (code === undefined) throw new Error(`missing built bundle ${plugin.url}`)
    ;(0, eval)(code)
  }
  act(() => {
    /** 负责加载其余插件并运行应用的 Web 入口实例。 */
    const entry = new AppWebEntry(root, {
      loadBundle: async (url) => {
        /** 当前请求插件 URL 对应的构建代码。 */
        const code = bundles.get(url)
        if (code === undefined) throw new Error(`missing built bundle ${url}`)
        ;(0, eval)(code)
      },
    })
    void entry.run()
    unmount = () => entry.dispose()
  })
}

/**
 * Match a CSS-module class by its logical name.
 * Module class names carry a per-build hash in one of two schemes —
 * ui-primitives emits `_<name>_<hash>` (name bounded by underscores),
 * feature bundles emit `<hash>_<name>` (name at the end) — and a longer name
 * containing this one must not match (`line` must not hit `lineNumber`).
 * @param el - element whose class list is inspected.
 * @param name - logical (unhashed) module class name.
 * @returns whether the element carries that module class.
 */
/** 判断元素是否携带指定逻辑 CSS Module 类名，兼容两种构建哈希格式。 */
export function hasClass(el: Element, name: string): boolean {
  return [...el.classList].some(cls => cls === name || cls.endsWith(`_${name}`) || cls.startsWith(`_${name}_`) || cls.includes(`_${name}_`))
}

/**
 * Whether this run rewrites its golden instead of comparing against it, set by
 * the snapshot gate's `DSH_SNAPSHOT` mode (`record` re-runs the scenarios from
 * scratch, `refresh` re-derives the expected text from the existing ones).
 */
/** 当前运行是否会记录或刷新快照黄金文件。 */
export const REFRESHING_GOLDEN = process.env.DSH_SNAPSHOT === 'record' || process.env.DSH_SNAPSHOT === 'refresh'
