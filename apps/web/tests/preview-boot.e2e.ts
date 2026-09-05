/**
 * Preview acceptance: the browser-only worker deployment boots the real Cordis
 * tree out of the packed VFS image and reaches an interactive page.
 *
 * `dist/preview.html` is the served page plus one bootstrap script tag, so this
 * run exercises the shipped startup chain: the worker mounts the image,
 * activates the tree, and answers the page's tunnel until the client settles.
 * Two milestones prove that happened — the host's `tree active` boot line,
 * whose lowering contract must be the one this checkout's packer emits, and the
 * workspace hero, which paints only after the client tree comes up over the
 * tunnel. The same page opens the seeded Workspace and showcase Session,
 * verifies its tool/subagent/history examples, then writes through the
 * settings and credentials providers. That keeps the upstream Chokidar
 * instances exercised over the Worker filesystem implementation.
 *
 * The site is served the way a static host serves it: bytes from `dist/` with
 * no rewrite rules, so a missing file is a 404 rather than the index page.
 * @remarks 文件说明：文件职责：验证 apps/web 中 preview boot e2e 相关行为与失败场景。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { expect, it } from 'vitest'
import {
  composeProfile, configTrees, indexWorkspacePackages, packVfsImage, packVfsOverlay,
  previewFixtures, WRAPPER_CONTRACT,
} from '@deepseek-ai/dsh-experimental-webworker-packer'
import {
  IMAGE_FILE_NAME, PREVIEW_FIXTURE_MANIFEST_FILE, PREVIEW_FIXTURE_MANIFEST_VERSION,
  type PreviewFixtureManifest,
} from '@deepseek-ai/dsh-experimental-webworker-runtime'
import { buildVfsExampleFiles } from '../../../packages/experimental/webworker-runtime/tests/vfs-example-fixture.ts'
import { captureStableAria, compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

/**
 * 常量说明：DIST_ROOT 用于处理 DIST_ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

/** Where the client looks for the image: the runtime's own name, beside the page.
 * @remarks 中文说明：常量说明：IMAGE_FILE 用于处理 IMAGE_FILE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const IMAGE_FILE = join(DIST_ROOT, 'preview', IMAGE_FILE_NAME)

/** Keyless browser golden for the pre-Worker source chooser. */
const SOURCE_CHOOSER_EXPECTED = fileURLToPath(new URL('./snapshots/preview-boot/source-chooser.expected.md', import.meta.url))

/**
 * 常量说明：SNAPSHOT_MODE 用于处理 SNAPSHOT_MODE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SNAPSHOT_MODE = webSnapshotMode()

/** Profile the preview deployment composes; `build:preview` packs the same one.
 * @remarks 中文说明：常量说明：PROFILE 用于处理 PROFILE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const PROFILE = 'web'

/** Stable labels authored by the deterministic VFS example fixture.
 * @remarks 中文说明：常量说明：SHOWCASE_TITLE 用于处理 SHOWCASE_TITLE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const SHOWCASE_TITLE = 'WebWorker Preview Showcase'
/**
 * 常量说明：SHOWCASE_TAIL 用于处理 SHOWCASE_TAIL 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SHOWCASE_TAIL = 'Preview tour complete'
/**
 * 常量说明：SHOWCASE_OLDEST 用于处理 SHOWCASE_OLDEST 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SHOWCASE_OLDEST = 'History checkpoint 01: verify deterministic preview state.'

/** Pages the preview needs; the Vite build emits both.
 * @remarks 中文说明：常量说明：PAGES 用于处理 PAGES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const PAGES = ['index.html', 'preview.html']

/**
 * Content types the preview loads. Anything else is served as opaque bytes.
 *
 * The image goes out as `application/gzip` with no `content-encoding`: the
 * worker inflates the gzip member itself, so a transport-decoded body would
 * leave its `DecompressionStream('gzip')` with plain tar bytes to inflate.
 * @remarks 中文说明：常量说明：MIME 用于处理 MIME 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

/** Boot line the worker host writes once its tree finished activating.
 * @remarks 中文说明：常量说明：TREE_ACTIVE 用于处理 TREE_ACTIVE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const TREE_ACTIVE = 'webworker host: tree active'

/** Image fetch, mount, and tree activation on a loaded machine.
 * @remarks 中文说明：常量说明：BOOT_TIMEOUT_MS 用于处理 BOOT_TIMEOUT_MS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const BOOT_TIMEOUT_MS = 240_000

/** Client tree settle after the tunnel starts answering.
 * @remarks 中文说明：常量说明：HERO_TIMEOUT_MS 用于处理 HERO_TIMEOUT_MS 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const HERO_TIMEOUT_MS = 240_000

/** One served origin over `dist/`. */
interface Site {
  readonly origin: string
  /** Release the port; call after the browser is gone.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): Promise<void>
}

interface PreviewAssets {
  /** Static-host-relative path to a generated file outside `dist/`. */
  readonly overrides: ReadonlyMap<string, string>
  /**
   * 功能说明：处理 cleanup 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cleanup()，并按返回类型处理结果。
   */
  cleanup(): void
}

/**
 * Fail before the browser opens a page the build never produced.
 * @throws When either preview page is missing from `dist/`.
 * @remarks 中文说明：功能说明：处理 requirePreviewPages 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * requirePreviewPages()，并按返回类型处理结果。
 */
function requirePreviewPages(): void {
  for (const /* 变量说明：page 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。 */ page of PAGES) {
    if (existsSync(join(DIST_ROOT, page))) continue
    throw new Error(`preview boot needs apps/web/dist/${page} — run \`pnpm run build\` from the repository root`)
  }
}

/**
 * The base image, fixture manifest, and overlays to serve. `pnpm run build`
 * emits the pages but only `build:preview` packs the image, so this lane packs
 * a missing image rather than skipping the deployment it accepts. The example
 * overlay pairs its committed Session generations with the generator-owned
 * current projection cache. The worker therefore exercises historical reads
 * without relying on a stale cache schema. Generated files land in a temp
 * directory, never in `dist/`: the
 * client-artifact digest record treats `dist/` as build-owned, so a test write
 * there fails the record check for every later consumer.
 * @returns Static-path overrides and their teardown.
 * @throws When the closure leaves dependencies unresolved, which would pack an
 * incomplete image the tree fails on later and further from the cause.
 * @remarks 中文说明：功能说明：处理 requireVfsAssets 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：PreviewAssets；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * requireVfsAssets()，并按返回类型处理结果。
 */
function requireVfsAssets(): PreviewAssets {
  /**
   * 常量说明：fixtureDefinitions 用于处理 fixtureDefinitions 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const fixtureDefinitions = previewFixtures(REPO_ROOT)
  const directory = mkdtempSync(join(tmpdir(), 'dsh-preview-boot-'))
  /**
   * 常量说明：overrides 用于处理 overrides 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const overrides = new Map<string, string>()
  /**
   * 常量说明：writeAsset 用于写入 Asset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：写入 Asset 相关流程；使用场景由所在模块及调用位置决定。
   * @param relativePath （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param bytes （Uint8Array | string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 writeAsset(relativePath, bytes)，并按返回类型处理结果。
   */
  const writeAsset = (relativePath: string, bytes: Uint8Array | string): void => {
    /**
     * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const path = join(directory, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
    overrides.set(relativePath, path)
  }
  if (!existsSync(IMAGE_FILE)) {
    const packed = packVfsImage({
      config: composeProfile(REPO_ROOT, PROFILE),
      profile: PROFILE,
      workspaces: indexWorkspacePackages(REPO_ROOT),
      resolveFrom: REPO_ROOT,
      configTrees: configTrees(REPO_ROOT),
    })
    if (packed.missing.length > 0) {
      throw new Error(`preview boot: ${String(packed.missing.length)} dependencies did not resolve: ${packed.missing.join(', ')}`)
    }
    writeAsset(`preview/${IMAGE_FILE_NAME}`, packed.image)
  }
  const currentCache = buildVfsExampleFiles().get('home/storages/session_projcache.json')
  if (currentCache === undefined) throw new Error('preview boot: generated example has no projection cache')
  const cacheDirectory = join(directory, 'current-projection-cache')
  mkdirSync(cacheDirectory, { recursive: true })
  writeFileSync(join(cacheDirectory, 'session_projcache.json'), currentCache)
  const fixtures = fixtureDefinitions.map((fixture) => {
    const relativePath = `preview/fixtures/${fixture.id}.tar.gz`
    const trees = fixture.id === 'vfs-example'
      ? [...fixture.trees, { mount: 'home/storages', directory: cacheDirectory }]
      : fixture.trees
    writeAsset(relativePath, packVfsOverlay(trees).image)
    return {
      id: fixture.id,
      label: fixture.label,
      description: fixture.description,
      overlays: [`fixtures/${fixture.id}.tar.gz`],
    }
  })
  const manifest: PreviewFixtureManifest = {
    version: PREVIEW_FIXTURE_MANIFEST_VERSION,
    defaultFixture: fixtures[0]?.id ?? null,
    fixtures,
  }
  writeAsset(`preview/${PREVIEW_FIXTURE_MANIFEST_FILE}`, `${JSON.stringify(manifest, null, 2)}\n`)
  return { overrides, cleanup: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { rmSync(directory, { recursive: true, force: true }) } }
}

/**
 * Answer one request with its generated override or the file under `dist/`.
 * @param request - Incoming request; only its path is read.
 * @param response - Response to write the bytes or the 404 to.
 * @param overrides - Generated deployment files served before `dist/`.
 */
async function respond(
  request: IncomingMessage,
  response: ServerResponse,
  overrides: ReadonlyMap<string, string>,
): Promise<void> {
  /**
   * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  /**
   * 常量说明：relative 用于处理 relative 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const relative = normalize(decodeURIComponent(path)).replace(/^\/+/, '')
  try {
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = await readFile(overrides.get(relative) ?? join(DIST_ROOT, relative))
    response.writeHead(200, { 'content-type': MIME[extname(relative)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    // A miss is a miss: the deployment has no SPA fallback, and hiding one
    // behind the index page would make a broken asset URL look like a boot
    // failure.
    response.writeHead(404)
    response.end(`not found: ${relative}`)
  }
}

/**
 * Serve `dist/` over loopback with static-host semantics.
 * @param overrides - Generated deployment files used when `dist/` has none.
 * @returns The origin to navigate, and its teardown.
 * @remarks 中文说明：功能说明：处理 serveDist 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：overrides（ReadonlyMap<string, string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：Promise<Site>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * serveDist(overrides)，并按返回类型处理结果。
 */
async function serveDist(overrides: ReadonlyMap<string, string>): Promise<Site> {
  /**
   * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const server = createServer(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
 * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, response)，
 * 并按返回类型处理结果。
 */ (request, response) => { void respond(request, response, overrides) })
  await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：listening（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(listening)，并按返回类型处理结果。
 */ (listening) => { server.listen(0, '127.0.0.1', listening) })
  /**
   * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('preview boot: the static server bound no port')
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      server.closeAllConnections()
      await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：closed（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(closed, reject)，
 * 并按返回类型处理结果。
 */ (closed, reject) => {
          server.close(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => {
              if (error === undefined) closed()
              else reject(error)
            })
        })
    },
  }
}

/**
 * Bound one boot milestone so a stall names the milestone instead of surfacing
 * as the lane's generic test timeout.
 * @param work - The milestone to wait for.
 * @param ms - How long it may take.
 * @param stalled - Error message when it does not arrive in time.
 * @returns What `work` resolved to.
 * @remarks 中文说明：功能说明：处理 within 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：work（Promise<T>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：ms（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：stalled（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<T>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 within(work, ms, stalled)，
 * 并按返回类型处理结果。
 */
async function within<T>(work: Promise<T>, ms: number, stalled: string): Promise<T> {
  /**
   * 变量说明：timer 用于处理 timer 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_, reject)，并按返回类型处理结果。
 */ (_, reject) => { timer = setTimeout(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { reject(new Error(stalled)) }, ms) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

it('boots the packed worker deployment to an interactive page', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
    requirePreviewPages()
    /**
   * 常量说明：assets 用于处理 assets 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
    const assets = requireVfsAssets()
    try {
    /**
     * 常量说明：site 用于处理 site 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const site = await serveDist(assets.overrides)
      try {
      /**
       * 常量说明：browser 用于处理 browser 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
        try {
          await bootEmptyPreview(site.origin, browser)
          await bootPreview(site.origin, browser)
        } finally {
          await browser.close()
        }
      } finally {
        await site.close()
      }
    } finally {
      assets.cleanup()
    }
  }, 600_000)

/**
 * Open the preview page and hold it to both boot milestones.
 * @param origin - Origin serving `dist/`.
 * @param browser - Browser to open the page in.
 * @remarks 中文说明：功能说明：处理 bootPreview 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：origin（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：browser（Browser）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 bootPreview(origin,
 * browser)，并按返回类型处理结果。
 */
async function bootPreview(origin: string, browser: Browser): Promise<void> {
  /**
   * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const page = await newEnglishPage(browser)
  /**
   * 常量说明：pageErrors 用于处理 pageErrors 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const pageErrors: Error[] = []
  /**
   * 常量说明：consoleErrors 用于处理 consoleErrors 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const consoleErrors: string[] = []
  page.on('pageerror', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => { pageErrors.push(error) })
  // Registered before navigation: the worker reports its tree long before the
  // tunnel serves the client, so a listener added later would miss the line.
  /**
   * 常量说明：treeActive 用于处理 treeActive 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const treeActive = new Promise<string>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：reported（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(reported)，并按返回类型处理结果。
 */ (reported) => {
      page.on('console', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ (message) => {
          /**
       * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const text = message.text()
          if (text.includes(TREE_ACTIVE)) reported(text)
          if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(text)
        })
    })
  try {
    await page.goto(`${origin}/preview.html`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Choose Preview data' }).waitFor()
    expect(await page.locator('input[name="preview-source"][value="vfs-example"]').isChecked()).toBe(true)
    expect(await page.getByText('Empty environment', { exact: true }).count()).toBe(1)
    expect(await page.getByText('WebFS directory', { exact: true }).count()).toBe(1)
    expect(await page.locator('input[name="preview-source"][value="webfs"]').isDisabled()).toBe(true)
    expect(await page.getByRole('textbox', { name: 'Choose workspace' }).count()).toBe(0)
    await compareOrRefreshGolden(
      SOURCE_CHOOSER_EXPECTED,
      await captureStableAria(page, '[data-preview-source-card]', '/__preview_no_workspace__'),
      SNAPSHOT_MODE,
    )
    await page.getByRole('button', { name: 'Start Preview' }).click()
    await page.getByText('Loading plugins…', { exact: true }).waitFor({ timeout: 10_000 })
    /**
     * 常量说明：bootLine 用于处理 bootLine 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bootLine = await within(treeActive, BOOT_TIMEOUT_MS, `preview boot: the worker never reported "${TREE_ACTIVE}"`)
    // The activated tree ran bodies lowered against the contract this
    // checkout's packer emits; a dist built before a contract change would
    // report the older one.
    expect(bootLine).toContain(`image lowering=${WRAPPER_CONTRACT}`)
    expect(bootLine).toContain('data overlays=1')
    // The versioned notice is the seeded preview's first stable interactive
    // surface after the startup chain completes over the tunnel.
    /**
     * 常量说明：continueButton 用于处理 continueButton 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const continueButton = page.getByRole('button', { name: 'Continue' })
    await continueButton.waitFor({ timeout: HERO_TIMEOUT_MS })
    await continueButton.click()
    /**
     * 常量说明：configureLater 用于处理 configureLater 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const configureLater = page.getByRole('button', { name: 'Configure later' })
    await configureLater.waitFor({ timeout: 30_000 })
    await configureLater.click()
    await page.locator('[data-composer-input][data-placeholder="Describe what you want to build... / commands, @ files or sessions"]')
      .waitFor({ timeout: 30_000 })

    /**
     * 常量说明：exercised 用于处理 exercised 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exercised = await page.evaluate(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        type Result<T> = { result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } } }
        interface PreviewTransport {
        /**
         * 功能说明：请求 fetch 相关流程；使用场景由所在模块及调用位置决定。
         * @param input （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
         * @param init （RequestInit）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
         * @returns Promise<Response>；调用方应按声明类型处理，不应假定未声明的附加状态。
         * @example 在完成前置校验后调用 fetch(input, init)，并按返回类型处理结果。
         */
          fetch(input: string, init: RequestInit): Promise<Response>
        }
        /**
       * 常量说明：transport 用于处理 transport 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const transport = (globalThis as typeof globalThis & { __DSH_TRANSPORT__?: PreviewTransport }).__DSH_TRANSPORT__
        if (transport === undefined) throw new Error('preview transport is absent after boot')
        /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const response = await transport.fetch('/api/session/list', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request', rpcId: 'preview-session-list', method: 'session/list',
            payload: { args: { _request: {} } },
          }),
        })
        /**
       * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const sessions = await response.json() as Result<{ items: Array<{ sessionId: string }> }>
        if (!sessions.result.ok) throw new Error(`session/list failed: ${sessions.result.error.message}`)
        /**
       * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const sessionId = sessions.result.value.items[0]?.sessionId
        if (sessionId === undefined) throw new Error('workspace adoption created no Session')

        // Remote namespaces answer over the same unary carrier; the args object
        // keys every wire parameter by its name.
        /**
       * 常量说明：remote 用于处理 remote 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       * 功能说明：处理 remote 相关流程；使用场景由所在模块及调用位置决定。
       * @param endpoint （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param args （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns Promise<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 remote(endpoint, args)，并按返回类型处理结果。
       */
        const remote = async <T>(endpoint: string, args: object): Promise<T> => {
        /**
         * 常量说明：answered 用于处理 answered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const answered = await transport.fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'client-request', rpcId: `preview-${endpoint.replace('/', '-')}`,
              method: endpoint, payload: { args },
            }),
          })
          /**
         * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const body = await answered.json() as Result<T>
          if (!body.result.ok) throw new Error(`${endpoint} failed: ${body.result.error.message}`)
          return body.result.value
        }
        /**
       * 常量说明：skills 用于处理 skills 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const skills = await remote<{ skills: Array<{ name: string }> }>(
          'skills/list', { request: { sessionId } },
        )
        /**
       * 常量说明：createDirectory 用于创建 Directory 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       * 功能说明：创建 Directory 相关流程；使用场景由所在模块及调用位置决定。
       * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
       * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 createDirectory(path, name)，并按返回类型处理结果。
       */
        const createDirectory = async (path: string, name: string): Promise<void> => {
          await remote<string>('directoryPicker/createDirectory', { path, name })
          await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { setTimeout(resolve, 250) })
          await remote<{ skills: Array<{ name: string }> }>(
            'skills/list', { request: { sessionId } },
          )
        }
        await createDirectory('/dsh/workspace/.agents/skills', 'runtime-created')
        // Settings and credentials both answer over the Remote carrier, so this
        // half of the sweep posts the generated endpoints directly like the
        // session read above.
        /**
       * 常量说明：settings 用于处理 settings 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const settings = await remote<{ namespaces: { ns: string; revision: number }[] }>(
          'settings/describe', {},
        )
        /**
       * 常量说明：shell 用于处理 shell 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const shell = settings.namespaces.find(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：namespace（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(namespace)，并按返回类型处理结果。
 */ namespace => namespace.ns === 'shell')
        if (shell === undefined) throw new Error('settings/describe omitted the shell namespace')
        await remote('settings/update', {
          ns: 'shell',
          patch: { timeoutMs: 61_000 },
          expectedRevision: shell.revision,
        })
        await remote('credentials/set', { ref: 'PREVIEW_TEST_SECRET', value: 'worker-only' })
        /**
       * 常量说明：credentials 用于处理 credentials 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
        const credentials = await remote<Record<string, { configured: boolean }>>(
          'credentials/describe',
          { refs: ['PREVIEW_TEST_SECRET'] },
        )
        await remote('credentials/unset', { ref: 'PREVIEW_TEST_SECRET' })
        await new Promise(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => { setTimeout(resolve, 250) })
        return {
          skillCount: skills.skills.length,
          credentialConfigured: credentials.PREVIEW_TEST_SECRET?.configured,
        }
      })
    expect(exercised.skillCount).toBeGreaterThan(0)
    expect(exercised.credentialConfigured).toBe(true)

    /**
     * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sessions = page.getByRole('tree', { name: 'Sessions' })
    /**
     * 常量说明：showcase 用于处理 showcase 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const showcase = sessions.getByRole('treeitem').filter({ hasText: SHOWCASE_TITLE })
    await expect.poll(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => showcase.count(), { timeout: 15_000 }).toBe(1)
    await showcase.click()
    await page.getByText(SHOWCASE_TAIL, { exact: true }).waitFor({ timeout: 30_000 })

    expect(await page.getByText(SHOWCASE_OLDEST, { exact: true }).count()).toBe(0)
    await page.getByText('PREVIEW.md', { exact: true }).waitFor()
    await page.getByText('src/preview.ts', { exact: true }).waitFor()
    await page.getByText('Update to-do list', { exact: true }).waitFor()
    await page.getByText('Error: ENOENT: no such file, open missing.txt', { exact: true }).waitFor()

    /**
     * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const subagents = page.getByRole('button', { name: '2 subagents' })
    await subagents.waitFor({ timeout: 15_000 })
    await subagents.hover()
    /**
     * 常量说明：catalog 用于处理 catalog 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const catalog = page.getByRole('tree', { name: 'Subagent sessions' })
    await catalog.getByRole('treeitem', { name: /Review preview architecture/ }).waitFor()
    await catalog.getByRole('treeitem', { name: /Continue preview verification/ }).waitFor()
    await catalog.press('Escape')

    await page.getByRole('button', { name: 'Load earlier', exact: true }).click()
    await page.getByText(SHOWCASE_OLDEST, { exact: true }).waitFor({ timeout: 15_000 })
    expect(pageErrors.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ error => error.message)).toEqual([])
    expect(consoleErrors.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
 */ line =>
        /watchFile|failed to watch|node-addon-landlock-run\.probe|sandbox backend is usable|SANDBOX_UNAVAILABLE/i.test(line))).toEqual([])
  } catch (/* 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。 */ error) {
    await saveFailureShot(page, 'preview-boot')
    throw pageErrors.length === 0
      ? error
      : new AggregateError([error, ...pageErrors], 'preview boot failed, with uncaught page errors')
  }
}

/** Verify the chooser can boot the untouched base image and reach first-run UI.
 * @remarks 中文说明：功能说明：处理 bootEmptyPreview 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：origin（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：browser（Browser）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 bootEmptyPreview(origin,
 * browser)，并按返回类型处理结果。 */
async function bootEmptyPreview(origin: string, browser: Browser): Promise<void> {
  /**
   * 常量说明：page 用于处理 page 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const page = await newEnglishPage(browser)
  /**
   * 常量说明：pageErrors 用于处理 pageErrors 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const pageErrors: Error[] = []
  /**
   * 常量说明：consoleErrors 用于处理 consoleErrors 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const consoleErrors: string[] = []
  /**
   * 常量说明：failedResponses 用于处理 failedResponses 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const failedResponses: string[] = []
  page.on('pageerror', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error) => { pageErrors.push(error) })
  page.on('response', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：response（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(response)，并按返回类型处理结果。
 */ (response) => {
      if (response.status() >= 400) failedResponses.push(new URL(response.url()).pathname)
    })
  /**
   * 常量说明：treeActive 用于处理 treeActive 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const treeActive = new Promise<string>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：reported（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(reported)，并按返回类型处理结果。
 */ (reported) => {
      page.on('console', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
 */ (message) => {
          /**
       * 常量说明：text 用于处理 text 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
          const text = message.text()
          if (text.includes(TREE_ACTIVE)) reported(text)
          if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(text)
        })
    })
  try {
    await page.goto(`${origin}/preview.html?preview-fixture=none`, { waitUntil: 'domcontentloaded' })
    expect(await page.getByRole('heading', { name: '选择 Preview 数据源' }).count()).toBe(0)
    /**
     * 常量说明：bootLine 用于处理 bootLine 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bootLine = await within(
      treeActive,
      BOOT_TIMEOUT_MS,
      `empty preview boot: the worker never reported "${TREE_ACTIVE}"`,
    )
    expect(bootLine).toContain(`image lowering=${WRAPPER_CONTRACT}`)
    expect(bootLine).toContain('data overlays=0')
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor({ timeout: HERO_TIMEOUT_MS })
    /**
     * 常量说明：sessionCount 用于处理 sessionCount 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const sessionCount = await page.evaluate(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
       * 常量说明：transport 用于处理 transport 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const transport = (globalThis as typeof globalThis & {
          __DSH_TRANSPORT__?: { /**
 * 功能说明：请求 fetch 相关流程；使用场景由所在模块及调用位置决定。
 * @param input （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param init （RequestInit）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<Response>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 fetch(input, init)，并按返回类型处理结果。
 */
            fetch(input: string, init: RequestInit): Promise<Response> }
        }).__DSH_TRANSPORT__
        if (transport === undefined) throw new Error('empty preview transport is absent after boot')
        /**
       * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const response = await transport.fetch('/api/session/list', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request', rpcId: 'empty-preview-session-list', method: 'session/list',
            payload: { args: { _request: {} } },
          }),
        })
        /**
       * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const body = await response.json() as {
          result: { ok: true; value: { items: unknown[] } } | { ok: false; error: { message: string } }
        }
        if (!body.result.ok) throw new Error(`empty session/list failed: ${body.result.error.message}`)
        return body.result.value.items.length
      })
    expect(sessionCount).toBe(0)
    expect(pageErrors.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ error => error.message)).toEqual([])
    expect(failedResponses).toEqual(['/plugins/events'])
    expect(consoleErrors.filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：line（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(line)，并按返回类型处理结果。
 */ line => !line.includes('Failed to load resource: the server responded with a status of 404')))
      .toEqual([])
  } catch (/* 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。 */ error) {
    await saveFailureShot(page, 'preview-boot-empty')
    throw pageErrors.length === 0
      ? error
      : new AggregateError([error, ...pageErrors], 'empty preview boot failed, with uncaught page errors')
  } finally {
    await page.close()
  }
}
