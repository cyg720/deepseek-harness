/**
 * Shared tsdown preset for UI plugin client bundles. Emits a closure-factory
 * artifact: the bundle calls window.__ModuleLoader__.load({id, factory})
 * and resolves externals through the injected require (loader module table —
 * cordis DI entities, no globals, no import map). CSS is compiled by
 * lightningcss inside the bundle: `x.module.css` yields its hashed class map
 * and injects a tagged style at factory execution, while `x.css?inline`
 * exports compiled text for a plugin-owned lifecycle effect. The virtual
 * loaders register each real stylesheet as a watch dependency.
 */
/**
 * 文件职责：集中生成客户端工作区的 tsdown 构建配置。
 * 技术维度：tsdown、ESM、React 转换、路径别名和产物清单。
 * 产品维度：让所有浏览器包以一致规则产出可发布模块。
 * 逻辑维度：发现入口并合并共享选项，再按包特性设置外部依赖。
 * 关键边界：配置运行于构建期；入口和 external 变化会影响所有客户端包。
 * 新手阅读建议：先看导出配置，再看入口发现与共享选项。
 */
import { readFile } from 'node:fs/promises'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'
import { optionalStringArray } from './modules/src/client/manifest.ts'
import { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS } from './web/src/platform.ts'
import { clientBuildEnvironmentDefines } from '../../scripts/client-build-environment.ts'

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline
 * (which requires @tsdown/css). The suffix matters: tsdown's guard matches ids
 * ending in `.css`, so the virtual id must not.
 */
/** 中文说明：当前处理步骤的局部值 CSS_VIRTUAL_PREFIX，取值由紧邻初始化决定，仅在当前作用域使用。 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
/** 中文说明：当前处理步骤的局部值 GLOBAL_CSS_VIRTUAL_PREFIX，取值由紧邻初始化决定，仅在当前作用域使用。 */
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:'
/** 中文说明：当前处理步骤的局部值 INLINE_CSS_VIRTUAL_PREFIX，取值由紧邻初始化决定，仅在当前作用域使用。 */
const INLINE_CSS_VIRTUAL_PREFIX = '\0dsh-inline-css:'
/** 中文说明：当前处理步骤的局部值 CSS_VIRTUAL_SUFFIX，取值由紧邻初始化决定，仅在当前作用域使用。 */
const CSS_VIRTUAL_SUFFIX = '.mjs'
/** 中文说明：当前处理步骤的局部值 INLINE_CSS_QUERY，取值由紧邻初始化决定，仅在当前作用域使用。 */
const INLINE_CSS_QUERY = '?inline'

/** Emit one plugin-owned style injector and an optional CSS Modules export. */
/** 中文说明：函数 styleInjectionModule 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  /** 中文说明：当前处理步骤的局部值 source，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/**
 * Wire/type layers a client bundle may inline: browser-safe contracts
 * with no runtime identity to share (no Symbol/instanceof/singleton state).
 * Everything else under @deepseek-ai/* is either a module-table entry
 * (external) or a leak the purity gate rejects.
 */
/** 中文说明：当前处理步骤的局部值 INLINE_SAFE，取值由紧邻初始化决定，仅在当前作用域使用。 */
export const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|file-reference|session|llm|tools|brand)(\/|$)/

/**
 * Vendored framework libraries: rescoped into @deepseek-ai, so the gate below
 * would read them as plugin packages. They carry no cross-plugin runtime
 * identity to share — the framework itself is a requested module-table row
 * (external), while these are ordinary libraries a browser bundle inlines.
 */
/** 中文说明：当前处理步骤的局部值 VENDORED_LIBRARY，取值由紧邻初始化决定，仅在当前作用域使用。 */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
/** 中文说明：当前处理步骤的局部值 GENERATED_REMOTE，取值由紧邻初始化决定，仅在当前作用域使用。 */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/**
 * Workspace mode replaces an empty config array with the root defaults. A
 * falsey entry instead removes this package before entry resolution.
 */
/** 中文说明：当前处理步骤的局部值 SKIP_WORKSPACE_BUILD，取值由紧邻初始化决定，仅在当前作用域使用。 */
const SKIP_WORKSPACE_BUILD: UserConfig = { entry: '' }

/** 中文说明：当前处理步骤的局部值 REPOSITORY_ROOT，取值由紧邻初始化决定，仅在当前作用域使用。 */
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Rebase a physical lib-relative source onto a browser URL that mirrors the repository directories. */
/** 中文说明：函数 browserSourcePath 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  /** 中文说明：当前处理步骤的局部值 physicalSource，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  /** 中文说明：当前处理步骤的局部值 repositoryPath，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const repositoryPath = relative(REPOSITORY_ROOT, physicalSource).split(sep).join('/')
  return repositoryPath.startsWith('packages/') ? `../../../${repositoryPath}` : source
}

/**
 * Build the tsdown config for one UI plugin package: the node-half lib build
 * plus the browser client bundle. Client packages emit both halves during the
 * Client pass by default; packages needed for Host reflection may opt into the
 * earlier Host pass. A package-level tsdown.config.ts REPLACES the root
 * workspace layout, so the lib half must be restated here — dropping it leaves
 * the package without lib/index.js and the host Loader cannot import its node
 * half.
 * @param id - plugin id (package name), stamped into the __ModuleLoader__.load
 * handoff and onto the injected style tags.
 * @param libEntry - node-half entries, spelled at the call site so the
 * package-invariants gate can see `lib/types/invariant.js` in each package's
 * own tsdown.config.ts (a preset-side glob hides it from the mechanical check).
 * @param options - phase placement, lib overrides, and companion Node configs.
 * @returns ENV-selected tsdown config for the current build face.
 */
/** 中文说明：函数 clientBundle 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): BuildFaceConfig {
  /** 中文说明：当前处理步骤的局部值 lib，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const lib = clientLibraryConfig(id, libEntry, options.lib)
  return ({ env }) => {
    /** 中文说明：当前处理步骤的局部值 face，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const face = buildFace(env?.DSH_BUILD_FACE)
    /** 中文说明：当前服务或测试对象 clientEntry，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const clientEntry = face === undefined ? 'src/client/index.ts' : 'lib/types/client/index.js'
    /** 中文说明：当前服务或测试对象 client，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const client = clientConfig(id, clientEntry)
    /** 中文说明：当前处理步骤的局部值 node，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const node = [lib, ...(options.companions ?? [])]
    if (face === 'host') return options.hostPhase === true ? node : [SKIP_WORKSPACE_BUILD]
    if (face === 'client') {
      return options.hostPhase === true ? [client] : [...node, client]
    }
    return [...node, client]
  }
}

/**
 * Build the tsdown config for a client library the compile shell links
 * statically (the static assembly channel: `apps/web` resolves the package
 * name, bundles the artifact, and owns the chunk layout and the CSS pipeline).
 *
 * Calling this preset is what puts a package in the static assembly channel,
 * so the call sites are the roster: gates read it through
 * {@link isStaticLinkedConfig} rather than a second hand-kept list. A package on
 * this roster must not be a module-table row as well — the browser would take
 * the statically linked copy and a provider's bytes would sit unused in its
 * bundle.
 *
 * Four artifact contracts:
 * 1. every bare specifier stays an import. The shell attributes chunk bytes by
 *    `node_modules/<pkg>`, so a dependency inlined into a workspace file is
 *    attributed to no npm package and its bytes fall into the index chunk,
 *    which collapses the vendor/index cache split.
 * 2. `esm` on `platform: 'browser'` — the shell is the only consumer.
 * 3. sourcemaps, chained through the tsc maps under `lib/types` to the sources.
 * 4. stylesheets ship with the package: a relative `.css` import survives as a
 *    relative external and the sheet is emitted under `lib/` at its
 *    `src`-relative path, so vite stays the only owner of class hashing.
 * @param id - package name, used in tsdown diagnostics.
 * @param libEntry - emitted JavaScript entries consumed from `lib/types`, one
 * bundle each: a multi-entry build would emit a hash-named shared chunk that
 * the exact `files` list cannot publish.
 * @returns ENV-selected tsdown config for the Client build face.
 */
/** 中文说明：函数 staticLinked 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function staticLinked(id: string, libEntry: readonly string[]): BuildFaceConfig {
  // Each entry names its own output file, so two entries with the same basename
  // would overwrite one artifact instead of emitting two.
  /** 中文说明：当前处理步骤的局部值 names，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const names = new Set(libEntry.map(entry => basename(entry, '.js')))
  if (names.size !== libEntry.length) {
    throw new Error(`tsdown: ${id} entries collide on an output name: ${libEntry.join(', ')}`)
  }
  return clientOnly(libEntry.map(entry => staticLinkedConfig(id, entry)))
}

/**
 * Whether a package's tsdown configs put it in the static assembly channel.
 * The roster has no separate list: gates load each package's own
 * `tsdown.config.ts`, call it for the Client face, and ask this.
 * @param configs - configs a package's build-face function returned.
 * @returns true when at least one config was built by {@link staticLinked}.
 */
/** 中文说明：函数 isStaticLinkedConfig 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function isStaticLinkedConfig(configs: readonly UserConfig[]): boolean {
  return configs.some(config => (config.plugins as readonly { name?: string }[] | undefined ?? [])
    .some(plugin => plugin.name === STATIC_LINKED_PLUGIN))
}

/**
 * Build a Client-only Node library during the Client pass.
 * @param id - Package name used in tsdown diagnostics.
 * @param libEntry - Emitted JavaScript entries consumed from `lib/types`.
 * @returns ENV-selected tsdown config for the Client build face.
 */
/** 中文说明：函数 clientLibrary 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function clientLibrary(id: string, libEntry: readonly string[]): BuildFaceConfig {
  /** 中文说明：当前处理步骤的局部值 lib，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const lib = clientLibraryConfig(id, libEntry)
  return clientOnly([lib])
}

/**
 * Select arbitrary package-local configs only during the Client pass.
 * @param configs - Node-side configs emitted after Client tsc.
 * @returns ENV-selected tsdown config for the Client build face.
 */
/** 中文说明：函数 clientOnly 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function clientOnly(configs: readonly UserConfig[]): BuildFaceConfig {
  return ({ env }) => buildFace(env?.DSH_BUILD_FACE) === 'host'
    ? [SKIP_WORKSPACE_BUILD]
    : [...configs]
}

/** 中文说明：类型 ClientBundleOptions 约束本文件数据字段及允许取值。 */
interface ClientBundleOptions {
  /** Emit the Node-side artifacts during the Host pass instead of the Client pass. */
  /** 中文说明：成员 hostPhase 保存实例运行状态，取值由声明类型限定。 */
  readonly hostPhase?: boolean
  /** Additional Node-side configs emitted alongside the package library. */
  /** 中文说明：成员 companions 保存实例运行状态，取值由声明类型限定。 */
  readonly companions?: readonly UserConfig[]
  /** Overrides for the package's primary Node-side library config. */
  /** 中文说明：成员 lib 保存实例运行状态，取值由声明类型限定。 */
  readonly lib?: UserConfig
}

/** 中文说明：类型 BuildFace 约束本文件数据字段及允许取值。 */
type BuildFace = 'host' | 'client' | undefined

/** 中文说明：类型 BuildFaceConfig 约束本文件数据字段及允许取值。 */
type BuildFaceConfig = (inlineConfig: Pick<UserConfig, 'env'>) => UserConfig[]

/** 中文说明：函数 buildFace 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function buildFace(value: unknown): BuildFace {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/** 中文说明：函数 clientLibraryConfig 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function clientLibraryConfig(
  id: string,
  libEntry: readonly string[],
  overrides: UserConfig = {},
): UserConfig {
  /** 中文说明：当前处理步骤的局部值 isProductionDependency，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const isProductionDependency = (specifier: string): boolean =>
    matchesSpecifier(productionExternals(id), specifier)
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      // The Node half runs from a real install: a production dependency is on
      // disk there and stays an import, everything else inlines. Stating both
      // halves takes the artifact off tsdown's getProductionDeps fallback, where
      // moving a dependency between npm sections silently re-bundles it.
      // Builtins keep tsdown's own handling (neither side claims them).
      neverBundle: isProductionDependency,
      alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !isProductionDependency(specifier),
    },
    ...overrides,
  }
}

/** The slice of the rolldown plugin context the stylesheet plugin uses. */
/** 中文说明：类型 AssetEmitter 约束本文件数据字段及允许取值。 */
interface AssetEmitter {
  /** 中文说明：方法 emitFile 的参数见签名，返回值供调用方使用；示例见本文件调用处。 */
  emitFile(file: {
    type: 'asset'
    fileName: string
    source: Uint8Array
    originalFileName: string
  }): string
}

/** 中文说明：函数 staticLinkedConfig 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function staticLinkedConfig(id: string, entry: string, outputName = basename(entry, '.js')): UserConfig {
  /** 中文说明：当前处理步骤的局部值 emitted，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const emitted = new Set<string>()
  return {
    name: id,
    entry: { [outputName]: entry },
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // The shell compiles this artifact, so its map is the only path from a
    // browser stack frame back to the TSX (tsc emits the lib/types half).
    sourcemap: true,
    plugins: [{
      // Contract 1. `pre` because tsdown's own deps plugin would otherwise
      // resolve and inline every specifier missing from the npm production
      // sections, which is the coupling this preset exists to remove. The name
      // is also the roster marker {@link isStaticLinkedConfig} reads.
      name: STATIC_LINKED_PLUGIN,
      resolveId: {
        order: 'pre' as const,
        handler(source: string, importer: string | undefined) {
          // An entry arrives without an importer and must stay internal.
          if (importer === undefined) return null
          return isBareSpecifier(source) ? { id: source, external: true } : null
        },
      },
    }, {
      // Contract 3. Rolldown does not read the `//# sourceMappingURL` of its
      // inputs, so each tsc map is handed over as that module's map and
      // composed into the bundle map; without it frames stop at the emitted
      // lib/types JavaScript instead of reaching the TSX.
      name: 'dsh-tsc-sourcemap',
      async load(id: string) {
        if (!id.includes(TYPES_MARKER) || !id.endsWith('.js') || !existsSync(`${id}.map`)) return null
        /** 中文说明：当前处理步骤的局部值 code，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const code = await readFile(id, 'utf8')
        return { code: code.replace(SOURCEMAP_COMMENT, ''), map: await readFile(`${id}.map`, 'utf8') }
      },
    }, {
      // Contract 4. The import survives verbatim and the sheet lands beside the
      // JavaScript, so the shell's CSS Modules pipeline sees a real stylesheet.
      name: 'dsh-css-asset',
      async resolveId(this: AssetEmitter, source: string, importer: string | undefined) {
        if (!source.endsWith('.css') || importer === undefined) return null
        /** 中文说明：当前处理步骤的局部值 { file, fileName }，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const { file, fileName } = stylesheetAsset(source, importer)
        if (!emitted.has(fileName)) {
          emitted.add(fileName)
          // originalFileName also puts the physical sheet in the watch graph.
          this.emitFile({ type: 'asset', fileName, source: await readFile(file), originalFileName: file })
        }
        // Every emitted chunk sits at the lib/ root, so the src-relative name
        // is what resolves from there. Rolldown keeps relative externals as
        // written instead of re-normalizing them.
        return { id: `./${fileName}`, external: true }
      },
    }],
  }
}

/** Whether a specifier names a package rather than a file next to its importer. */
/** 中文说明：函数 isBareSpecifier 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('\0') && !isAbsolute(specifier)
}

/**
 * Locate a stylesheet import against the package sources and name its emitted position.
 * @param source - relative import specifier as written in the source.
 * @param importer - absolute path of the importing module, emitted or source.
 * @returns the stylesheet on disk plus its `src`-relative name under `lib/`.
 */
/** 中文说明：函数 stylesheetAsset 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function stylesheetAsset(source: string, importer: string): { readonly file: string, readonly fileName: string } {
  /** 中文说明：当前处理步骤的局部值 file，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const file = sourceAssetPath(source, importer)
  /** 中文说明：当前处理步骤的局部值 boundary，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const boundary = file.lastIndexOf(SOURCE_MARKER)
  if (boundary < 0) throw new Error(`tsdown: stylesheet ${file} is outside the package sources`)
  return { file, fileName: file.slice(boundary + SOURCE_MARKER.length).split(sep).join('/') }
}

/** The manifest fields the build faces read to state their own module edges. */
/** 中文说明：类型 WorkspaceManifest 约束本文件数据字段及允许取值。 */
interface WorkspaceManifest {
  /** 中文说明：成员 name 保存实例运行状态，取值由声明类型限定。 */
  readonly name?: string
  /** Sections a real install materializes on disk next to the built package. */
  /** 中文说明：成员 dependencies 保存实例运行状态，取值由声明类型限定。 */
  readonly dependencies?: Record<string, string>
  /** 中文说明：成员 peerDependencies 保存实例运行状态，取值由声明类型限定。 */
  readonly peerDependencies?: Record<string, string>
  /** 中文说明：成员 optionalDependencies 保存实例运行状态，取值由声明类型限定。 */
  readonly optionalDependencies?: Record<string, string>
  /** 中文说明：成员 dsh 保存实例运行状态，取值由声明类型限定。 */
  readonly dsh?: { readonly client?: { readonly external?: unknown } }
}

/** 中文说明：当前处理步骤的局部值 manifestCache，取值由紧邻初始化决定，仅在当前作用域使用。 */
const manifestCache = new Map<string, WorkspaceManifest>()
/** 中文说明：当前处理步骤的局部值 productionExternalCache，取值由紧邻初始化决定，仅在当前作用域使用。 */
const productionExternalCache = new Map<string, readonly RegExp[]>()
/** 中文说明：当前服务或测试对象 clientExternalCache，取值由紧邻初始化决定，仅在当前作用域使用。 */
const clientExternalCache = new Map<string, ReadonlySet<string>>()

/**
 * Read one workspace package's manifest. Located by package name rather than by
 * cwd, because tsdown evaluates every package config with the repository root as
 * `process.cwd()` during a workspace build. Callers read it on the first
 * resolveId of a build, not while a config is built, so selecting a build face
 * never touches a manifest.
 * @param id - package name, as spelled at the preset call site.
 * @returns the parsed manifest.
 * @throws {Error} when no workspace package declares that name.
 */
/** 中文说明：函数 workspaceManifest 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function workspaceManifest(id: string): WorkspaceManifest {
  /** 中文说明：当前处理步骤的局部值 cached，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const cached = manifestCache.get(id)
  if (cached !== undefined) return cached
  /** 中文说明：当前处理步骤的局部值 manifestPath，取值由紧邻初始化决定，仅在当前作用域使用。 */
  for (const manifestPath of globSync('packages/*/*/package.json', { cwd: REPOSITORY_ROOT })) {
    /** 中文说明：当前处理步骤的局部值 manifest，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const manifest = JSON.parse(
      readFileSync(resolvePath(REPOSITORY_ROOT, manifestPath), 'utf8'),
    ) as WorkspaceManifest
    if (manifest.name !== id) continue
    manifestCache.set(id, manifest)
    return manifest
  }
  throw new Error(`tsdown: no packages/*/*/package.json declares the name ${id}`)
}

/**
 * External patterns for one package's Node half: its own production sections,
 * subpaths included.
 * @param id - package name, as spelled at the preset call site.
 * @returns one `^name(/|$)` pattern per production dependency, name-sorted.
 */
/** 中文说明：函数 productionExternals 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function productionExternals(id: string): readonly RegExp[] {
  /** 中文说明：当前处理步骤的局部值 cached，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const cached = productionExternalCache.get(id)
  if (cached !== undefined) return cached
  /** 中文说明：当前处理步骤的局部值 manifest，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const manifest = workspaceManifest(id)
  /** 中文说明：当前处理步骤的局部值 names，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  /** 中文说明：当前处理步骤的局部值 patterns，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const patterns = [...names].sort().map(name => new RegExp(`^${escapeSpecifier(name)}(/|$)`))
  productionExternalCache.set(id, patterns)
  return patterns
}

/**
 * Module-table specifiers one `dsh.client` declaration requests. Matching is
 * exact, never normalized: a package declares the specifier its own code
 * imports, and the loader keys static entries the same way.
 * @param subject - package name, used in diagnostics.
 * @param declaration - the package's `dsh.client` object.
 * @returns the requested specifiers, empty when the package declares none.
 * @throws {Error} when `external` is not a string array.
 */
/** 中文说明：函数 requestedExternals 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function requestedExternals(
  subject: string,
  declaration: { readonly external?: unknown },
): ReadonlySet<string> {
  return new Set(optionalStringArray(subject, 'dsh.client.external', declaration.external) ?? [])
}

/**
 * Module-table specifiers one package requests. The shell baseline is implicit
 * for every dynamic bundle; `dsh.client.external` only adds package-specific
 * dynamic rows or subpaths.
 * @param id - package name, as spelled at the preset call site.
 * @returns the baseline plus the package's explicit requests.
 */
/** 中文说明：函数 clientExternals 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function clientExternals(id: string): ReadonlySet<string> {
  /** 中文说明：当前处理步骤的局部值 cached，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const cached = clientExternalCache.get(id)
  if (cached !== undefined) return cached
  /** 中文说明：当前处理步骤的局部值 externals，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const externals = new Set([
    ...PLATFORM_MODULES,
    ...PRELOADED_CLIENT_EXTERNALS,
    ...requestedExternals(id, workspaceManifest(id).dsh?.client ?? {}),
  ])
  clientExternalCache.set(id, externals)
  return externals
}

/** Escape a package name for literal use inside a RegExp source. */
/** 中文说明：函数 escapeSpecifier 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function escapeSpecifier(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whether an import specifier is the package a pattern names, or one of its subpaths. */
/** 中文说明：函数 matchesSpecifier 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function matchesSpecifier(patterns: readonly RegExp[], specifier: string): boolean {
  return patterns.some(pattern => pattern.test(specifier))
}

/** 中文说明：函数 clientConfig 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function clientConfig(id: string, entry: string): UserConfig {
  /** 中文说明：当前传输或投影数据 isRequested，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const isRequested = (specifier: string): boolean => clientExternals(id).has(specifier)
  return {
    name: `${id}/client`,
    entry: { client: entry },
    // Browser bundle lands next to the node half (single lib/ artifact dir;
    // the entryFileNames pin keeps it exactly lib/client.js). clean must stay
    // off — a default clean would wipe the node-half output emitted above.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // Types ship from lib/types (tsc); dts here would wrap the banner/footer into .d.cts and break parsing.
    dts: false,
    // Plugin code is fetched outside Vite's module graph, so its own bundle
    // must carry the TS/TSX mapping consumed by browser profiling tools.
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: isRequested,
      // Anything NOT requested from the loader module table must inline
      // (wire/type layers, zod, clsx — every non-shared dep). A require() the
      // table cannot answer is a guaranteed runtime throw, so the rule is the
      // package's own request list: requested specifiers stay imports,
      // everything else is bundled.
      alwaysBundle: (specifier: string) => !isRequested(specifier),
    },
    // Browser bundles inline node-idiom deps (zustand/immer read
    // process.env.NODE_ENV; zustand's esm build also probes
    // import.meta.env.MODE, which a CJS output cannot carry — rolldown flags
    // EMPTY_IMPORT_META). vite defined both on the seed path; tsdown inlining
    // needs the substitutions here or the factory throws ReferenceError at
    // boot / the build gate reds. Both keys honor the build's NODE_ENV so a
    // dev build keeps the dev-branch semantics; artifacts default to production.
    // The bare `import.meta.env` key is required alongside the precise MODE
    // key: zustand probes `import.meta.env ? import.meta.env.MODE : ...`, and
    // the truthiness probe would otherwise survive as an empty import.meta.
    define: {
      ...clientBuildEnvironmentDefines(process.env),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      // Bundle purity gate (build-time mirror of the module-edge rules): the
      // baseline and package-specific requests stay external, inline-safe wire layers
      // inline, and every other @deepseek-ai value import is a build error — a
      // cross-plugin value import either inlines a duplicate runtime instance
      // or requires a specifier the module table cannot answer for this package.
      // Cross-plugin collaboration goes through cordis services instead.
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (isRequested(source)) return null // requested module-table row: external wins
        if (VENDORED_LIBRARY.test(source)) return null // vendored library: inline, no shared identity
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point
        throw new Error(
          `client bundle purity: "${source}" is not in the default client externals or ${id}'s dsh.client.external, an inline-safe wire layer, or a generated /remote contribution — `
          + 'cross-plugin value imports are forbidden; declare a non-default module request or collaborate through cordis services '
          + '(type-only imports are erased and never reach this gate)',
        )
      },
    }, {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        /** 中文说明：当前处理步骤的局部值 abs，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        /** 中文说明：标识或顺序值 fileId，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        // The virtual id otherwise hides the physical stylesheet from Rolldown's watch graph.
        this.addWatchFile(fileId)
        /** 中文说明：当前处理步骤的局部值 source，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const source = await readFile(fileId)
        /** 中文说明：当前处理步骤的局部值 { code, exports，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        /** 中文说明：当前处理步骤的局部值 classMap，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const classMap: Record<string, string> = {}
        /** 中文说明：按序保存的数据集合 exportEntries，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const exportEntries = Object.entries(cssExports ?? {})
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        /** 中文说明：当前处理步骤的局部值 [local，取值由紧邻初始化决定，仅在当前作用域使用。 */
        for (const [local, exp] of exportEntries) classMap[local] = exp.name
        return styleInjectionModule(id, fileId, code.toString(), classMap)
      },
    }, {
      name: 'dsh-css-text-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
        /** 中文说明：当前处理步骤的局部值 stylesheet，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
        /** 中文说明：当前处理步骤的局部值 abs，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const abs = importer !== undefined ? sourceAssetPath(stylesheet, importer) : stylesheet
        return INLINE_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
        /** 中文说明：标识或顺序值 fileId，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        /** 中文说明：当前处理步骤的局部值 source，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const source = await readFile(fileId)
        /** 中文说明：当前处理步骤的局部值 { code }，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const { code } = transform({ filename: fileId, code: source, minify: true })
        return `export default ${JSON.stringify(code.toString())};`
      },
    }, {
      name: 'dsh-css-global-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
        /** 中文说明：当前处理步骤的局部值 abs，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return GLOBAL_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
        /** 中文说明：标识或顺序值 fileId，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        /** 中文说明：当前处理步骤的局部值 source，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const source = await readFile(fileId)
        /** 中文说明：当前处理步骤的局部值 { code }，取值由紧邻初始化决定，仅在当前作用域使用。 */
        const { code } = transform({ filename: fileId, code: source, minify: true })
        return styleInjectionModule(id, fileId, code.toString())
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      // The map is served from /plugins/<scoped-package>/client.js.map. The
      // browser resolves its local sources back into URLs that mirror the
      // /packages/<group>/<package>/src directories; sourcesContent keeps them usable
      // without exposing that tree as an HTTP route.
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/** Path segment separating a package's tsc output from the sources it was emitted from. */
/** 中文说明：当前处理步骤的局部值 TYPES_MARKER，取值由紧邻初始化决定，仅在当前作用域使用。 */
const TYPES_MARKER = `${sep}lib${sep}types${sep}`

/** Plugin name carrying contract 1, and the marker that identifies a statically linked config. */
/** 中文说明：当前处理步骤的局部值 STATIC_LINKED_PLUGIN，取值由紧邻初始化决定，仅在当前作用域使用。 */
const STATIC_LINKED_PLUGIN = 'dsh-static-linked-external'

/** Path segment a package's sources hang under, and the root emitted assets mirror. */
/** 中文说明：当前处理步骤的局部值 SOURCE_MARKER，取值由紧邻初始化决定，仅在当前作用域使用。 */
const SOURCE_MARKER = `${sep}src${sep}`

/** Trailing sourcemap reference tsc appends to every emitted module. */
/** 中文说明：当前处理步骤的局部值 SOURCEMAP_COMMENT，取值由紧邻初始化决定，仅在当前作用域使用。 */
const SOURCEMAP_COMMENT = /\n\/\/# sourceMappingURL=.*\s*$/

/** Resolve an emitted JS asset import against its source-tree counterpart. */
/** 中文说明：函数 sourceAssetPath 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function sourceAssetPath(source: string, importer: string): string {
  /** 中文说明：当前处理步骤的局部值 emitted，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  /** 中文说明：当前处理步骤的局部值 boundary，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}
