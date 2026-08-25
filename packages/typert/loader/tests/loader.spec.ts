/**
 * 文件职责：验证 loader.spec.ts 覆盖的Typert 类型系统行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的Typert 类型系统能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as typertLoader from '@deepseek-ai/dsh-typert-loader'
import { validateTypertManifest } from '@deepseek-ai/dsh-typert-loader'
import { z } from 'zod'

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let root: string | undefined
/** 中文说明：变量 context 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  Reflect.deleteProperty(globalThis, '__dshTypertLoaderGate')
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write a fake installed package under the fixture root's node_modules. */
/* 中文说明：函数 writePackage 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function writePackage(
  base: string,
  pkgName: string,
  options: {
    typertExport?: boolean
    typertTarget?: unknown
    typertSource?: string
    pluginSource?: string
    omitExports?: boolean
  } = {},
): Promise<void> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = join(base, 'node_modules', ...pkgName.split('/'))
  await mkdir(dir, { recursive: true })
  /** 中文说明：变量 exportsField 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const exportsField: Record<string, unknown> = { '.': './index.js', './package.json': './package.json' }
  if (options.typertExport !== false && options.typertSource !== undefined) {
    exportsField['./typert'] = options.typertTarget ?? './typert.host.js'
  }
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: pkgName,
    type: 'module',
    ...(options.omitExports ? { main: './index.js' } : { exports: exportsField }),
  }))
  await writeFile(join(dir, 'index.js'), options.pluginSource ?? 'export function apply() {}\n')
  if (options.typertSource !== undefined) {
    await writeFile(join(dir, 'typert.host.js'), options.typertSource)
  }
}

/** 中文说明：函数 typertSource 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function typertSource(pkgName: string, entryName: string): string {
  return [
    'import { z } from \'zod\'',
    `export const ${entryName} = z.object({ id: z.string() })`,
    'export const TYPERT = {',
    `  package: '${pkgName}',`,
    '  face: \'host\',',
    `  schemas: [{ name: '${entryName}', schema: ${entryName} }],`,
    '  model: { services: [], events: [], objects: [] },',
    '  invocations: [],',
    '}',
    '',
  ].join('\n')
}

/** 中文说明：函数 invocationTypertSource 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function invocationTypertSource(pkgName: string): string {
  return [
    'import { z } from \'zod\'',
    'const Text = z.string()',
    'export const TYPERT = {',
    `  package: '${pkgName}',`,
    '  face: \'host\',',
    '  schemas: [],',
    '  model: { services: [], events: [], objects: [] },',
    '  invocations: [{',
    `    id: '${pkgName}#goals/create',`,
    '    service: \'goals\', namespace: \'goals\', method: \'create\',',
    '    invocation: { kind: \'direct\' },',
    '    parameters: [{',
    '      name: \'request\', wire: \'request\', source: \'json\',',
    `      codec: { mode: 'strict', typeSymbol: '${pkgName}/types#Request', schema: Text },`,
    '    }],',
    "    cancellation: { parameter: 'signal' },",
    `    result: { mode: 'strict', typeSymbol: '${pkgName}/types#Result', schema: Text },`,
    '    sourceLocation: { file: \'src/index.ts\', line: 8, column: 3 },',
    '  }],',
    '}',
    '',
  ].join('\n')
}

/** Boot a real Loader over a fixture root; plugin modules resolve from its node_modules. */
/* 中文说明：函数 boot 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function boot(): Promise<Context> {
  context = new Context()
  context.baseUrl = pathToFileURL(join(root as string, 'cordis.yml')).href
  await context.plugin(TypertRegistry)
  await context.plugin(Loader)
  /** 中文说明：变量 fixtureRequire 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fixtureRequire = createRequire(context.baseUrl)
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      /** 中文说明：变量 module 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const module: unknown = await import(pathToFileURL(fixtureRequire.resolve(specifier)).href)
      return module
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  // zod must be resolvable from the fixture packages; link the workspace copy.
  await mkdir(join(root as string, 'node_modules'), { recursive: true })
  return context
}

/** 中文说明：函数 linkZod 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function linkZod(base: string): Promise<void> {
  const { symlink } = await import('node:fs/promises')
  /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const target = join(base, 'node_modules', 'zod')
  /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const source = fileURLToPath(new URL('.', import.meta.resolve('zod/package.json')))
  await mkdir(join(base, 'node_modules'), { recursive: true })
  await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
}

/** 中文说明：函数 mountTypertLoader 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function mountTypertLoader(ctx: Context, config: typertLoader.Config = {}): ReturnType<Context['plugin']> {
  return ctx.plugin(typertLoader, config)
}

// Fixture setup writes fake installed packages and boots a real Loader; the
// default 5s deadline is too tight on slow CI filesystems.
/** 中文说明：常量 LOADER_TEST_TIMEOUT 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const LOADER_TEST_TIMEOUT = { timeout: 60_000 }

describe('typert loader', () => {
  it('registers an explicit package without a Loader entry and withdraws it with the loader', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    await writePackage(root, '@fixture/nested', { typertSource: typertSource('@fixture/nested', 'Nested') })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()

    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = mountTypertLoader(ctx, { packages: ['@fixture/nested'] })
    await fiber
    expect(ctx.typert.get('@fixture/nested#Nested')).toBeDefined()

    await fiber.dispose()
    expect(ctx.typert.getPackage('@fixture/nested')).toBeUndefined()
  })

  it('registers a strict invocation into the local registry and withdraws it with the loader', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    await writePackage(root, '@fixture/invocation', {
      typertSource: invocationTypertSource('@fixture/invocation'),
    })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()

    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = mountTypertLoader(ctx, { packages: ['@fixture/invocation'] })
    await fiber

    /** 中文说明：变量 descriptor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const descriptor = ctx.typert.local.get('goals/create')
    expect(descriptor).toMatchObject({
      id: '@fixture/invocation#goals/create',
      invocation: { kind: 'direct' },
      parameters: [{ wire: 'request', source: 'json' }],
      cancellation: { parameter: 'signal' },
      sourceLocation: { file: 'src/index.ts', line: 8, column: 3 },
    })
    expect(descriptor?.parameters[0]?.codec.mode).toBe('strict')
    if (descriptor?.parameters[0]?.codec.mode === 'strict') {
      expect(descriptor.parameters[0].codec.schema.parse('request')).toBe('request')
    }

    await fiber.dispose()
    expect(ctx.typert.local.get('goals/create')).toBeUndefined()
  })

  it('fails loud when an explicit package is absent or has no Typert export', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await writePackage(root, '@fixture/plain')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()

    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let failure: unknown
    try {
      await mountTypertLoader(ctx, { packages: ['@fixture/missing', '@fixture/plain'] })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as Error).message).toContain('configured package "@fixture/missing" cannot be resolved')
    expect((failure as Error).message).toContain('configured package "@fixture/plain" does not export "./typert"')
  })

  it('auto-registers a mounted package exporting ./typert and withdraws it on unmount', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    await writePackage(root, '@fixture/with-typert', { typertSource: typertSource('@fixture/with-typert', 'Thing') })
    await writePackage(root, '@fixture/plain')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()

    /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const id = await ctx.loader.create({ name: '@fixture/with-typert' })
    /** 中文说明：变量 plainId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plainId = await ctx.loader.create({ name: '@fixture/plain' })
    await ctx.loader.await()
    await mountTypertLoader(ctx)
    await ctx.loader.await()

    /** 中文说明：变量 record 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const record = ctx.typert.get('@fixture/with-typert#Thing')
    expect(record).toMatchObject({ package: '@fixture/with-typert', face: 'host', name: 'Thing' })
    expect(record?.schema.safeParse({ id: 'x' }).success).toBe(true)
    // The plain package is silently skipped.
    expect(ctx.typert.list().map(r => r.key)).toEqual(['@fixture/with-typert#Thing'])

    /** 中文说明：函数值 mounted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const mounted = [...ctx.loader.entries()].find(entry => entry.options.name === '@fixture/with-typert')
    if (mounted?.fiber === undefined) throw new Error('fixture loader entry has no fiber')
    ctx.emit('internal/plugin', mounted.fiber)
    ctx.emit('internal/plugin', mounted.fiber)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx.typert.list()).toHaveLength(1)

    await ctx.loader.remove(id)
    await ctx.loader.await()
    // The unmount reconciliation rides a queued microtask flush.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx.typert.get('@fixture/with-typert#Thing')).toBeUndefined()
    await ctx.loader.remove(plainId)
    await ctx.loader.await()
    await new Promise(resolve => setTimeout(resolve, 20))

    await ctx.loader.create({ name: '@fixture/with-typert' })
    await ctx.loader.await()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(ctx.typert.get('@fixture/with-typert#Thing')).toBeDefined()
  })

  it('follows entries mounted after activation', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    await writePackage(root, '@fixture/late', { typertSource: typertSource('@fixture/late', 'Late') })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()
    await mountTypertLoader(ctx)

    expect(ctx.typert.get('@fixture/late#Late')).toBeUndefined()
    await ctx.loader.create({ name: '@fixture/late' })
    await ctx.loader.await()
    // Contributor import settles after Loader's own await boundary.
    await vi.waitFor(() => {
      expect(ctx.typert.get('@fixture/late#Late')).toBeDefined()
    }, { timeout: 10_000 })
  })

  it('drops an in-flight manifest when the loader is disposed before import settles', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    /** 中文说明：函数值 markStarted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let markStarted: (() => void) | undefined
    /** 中文说明：函数值 started 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    /** 中文说明：函数值 releaseImport 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let releaseImport: (() => void) | undefined
    /** 中文说明：函数值 wait 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const wait = new Promise<void>((resolve) => { releaseImport = resolve })
    Reflect.set(globalThis, '__dshTypertLoaderGate', {
      started: (): void => { markStarted?.() },
      wait,
    })
    await writePackage(root, '@fixture/pending', {
      typertSource: [
        'import { z } from \'zod\'',
        'globalThis.__dshTypertLoaderGate.started()',
        'await globalThis.__dshTypertLoaderGate.wait',
        'export const Pending = z.object({ id: z.string() })',
        'export const TYPERT = {',
        '  package: \'@fixture/pending\',',
        '  face: \'host\',',
        '  schemas: [{ name: \'Pending\', schema: Pending }],',
        '  model: { services: [], events: [], objects: [] },',
        '  invocations: [],',
        '}',
        '',
      ].join('\n'),
    })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()
    /** 中文说明：变量 loaderFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaderFiber = mountTypertLoader(ctx)
    await loaderFiber
    await ctx.loader.create({ name: '@fixture/pending' })
    await ctx.loader.await()
    await started

    /** 中文说明：函数值 mounted 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const mounted = [...ctx.loader.entries()].find(entry => entry.options.name === '@fixture/pending')
    if (mounted?.fiber === undefined) throw new Error('fixture loader entry has no fiber')
    ctx.emit('internal/plugin', mounted.fiber)
    await Promise.resolve()

    /** 中文说明：函数值 queued 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let queued: (() => void) | undefined
    /** 中文说明：函数值 queue 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => { queued = callback })
    ctx.emit('internal/plugin', mounted.fiber)
    queue.mockRestore()

    await loaderFiber.dispose()
    queued?.()
    releaseImport?.()
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(ctx.typert.getPackage('@fixture/pending')).toBeUndefined()
  })

  it('fails activation loud when an already-mounted contributor is malformed', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    await writePackage(root, '@fixture/broken', {
      typertSource: 'export const TYPERT = { package: \'@fixture/broken\', face: \'host\', schemas: [{ name: \'\', schema: {} }], model: { services: [], events: [], objects: [] }, invocations: [] }\n',
    })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()
    await ctx.loader.create({ name: '@fixture/broken' })
    await ctx.loader.await()

    await expect(mountTypertLoader(ctx)).rejects.toThrow(/typert contributor\(s\) failed to register/)
  })

  it('fails loud when the declared typert module cannot be imported', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    await writePackage(root, '@fixture/no-module', {
      typertSource: 'import { missing } from \'./nope.js\'\nexport const TYPERT = missing\n',
    })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()
    await ctx.loader.create({ name: '@fixture/no-module' })
    await ctx.loader.await()

    await expect(mountTypertLoader(ctx)).rejects.toThrow(/importing .* failed/)
  })

  it('accepts conditional artifact exports and skips packages with no exports field', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    await writePackage(root, '@fixture/conditional', {
      typertSource: typertSource('@fixture/conditional', 'Conditional'),
      typertTarget: { default: './typert.host.js' },
    })
    await writePackage(root, '@fixture/no-exports', { omitExports: true })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()
    await ctx.loader.create({ name: '@fixture/conditional' })
    await ctx.loader.create({ name: '@fixture/no-exports' })
    await ctx.loader.await()

    await mountTypertLoader(ctx)

    expect(ctx.typert.get('@fixture/conditional#Conditional')).toBeDefined()
    expect(ctx.typert.getPackage('@fixture/no-exports')).toBeUndefined()
  })

  it('aggregates unsupported package export shapes during activation', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    await writePackage(root, '@fixture/export-shape', {
      typertSource: typertSource('@fixture/export-shape', 'Shape'),
      typertTarget: { default: 1 },
    })
    await writePackage(root, '@fixture/export-primitive', {
      typertSource: typertSource('@fixture/export-primitive', 'Primitive'),
      typertTarget: 1,
    })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()
    await ctx.loader.create({ name: '@fixture/export-shape' })
    await ctx.loader.create({ name: '@fixture/export-primitive' })
    await ctx.loader.await()

    await expect(mountTypertLoader(ctx)).rejects.toThrow('must be a string or an object with a string default')
  })

  it('caches a negative verdict for loader entries without a package root', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== 'virtual-plugin') throw new Error(`unexpected fixture import ${specifier}`)
        return { apply() {} }
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'virtual-plugin' })
    await ctx.loader.await()

    await mountTypertLoader(ctx)

    expect(ctx.typert.getPackage('virtual-plugin')).toBeUndefined()
  })

  it('requires a config-tree resolution anchor', LOADER_TEST_TIMEOUT, async () => {
    context = new Context()
    await context.plugin(TypertRegistry)
    await context.plugin(Loader)

    await expect(mountTypertLoader(context)).rejects.toThrow('ctx.baseUrl is unset')
  })

  it('contains steady-state registration failures and normalizes non-Error throws', LOADER_TEST_TIMEOUT, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-typert-loader-'))
    await linkZod(root)
    await writePackage(root, '@fixture/steady-failure', {
      typertSource: typertSource('@fixture/steady-failure', 'Steady'),
    })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await boot()
    await mountTypertLoader(ctx)
    /** 中文说明：函数值 logged 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const logged = vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined)
    vi.spyOn(ctx.typert, 'register').mockImplementation(() => { throw 'register failed' })

    await ctx.loader.create({ name: '@fixture/steady-failure' })
    await ctx.loader.await()
    // The failing contributor's error is reported on the post-await flush.
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'register failed' }))
    }, { timeout: 10_000 })
    expect(ctx.typert.getPackage('@fixture/steady-failure')).toBeUndefined()
  })
})

describe('validateTypertManifest', () => {
  /** 中文说明：变量 zodish 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const zodish = { _zod: {} }

  it('accepts a well-formed manifest and rejects each malformed field loudly', () => {
    expect(validateTypertManifest('pkg', {
      package: 'pkg',
      face: 'host',
      schemas: [{ name: 'A', schema: zodish }],
      model: { services: [], events: [], objects: [] },
      invocations: [],
    }).schemas).toHaveLength(1)

    expect(() => validateTypertManifest('pkg', undefined)).toThrow('no TYPERT manifest object')
    expect(() => validateTypertManifest('pkg', { package: 'other' })).toThrow('must be owned by the package')
    expect(() => validateTypertManifest('pkg', { package: 'pkg', face: 'client' })).toThrow('TYPERT.face is not "host"')
    expect(() => validateTypertManifest('pkg', { package: 'pkg', face: 'host', schemas: 'x' })).toThrow('schemas must be an array')
    expect(() => validateTypertManifest('pkg', { package: 'pkg', face: 'host', schemas: [null] })).toThrow('non-object schema')
    expect(() => validateTypertManifest('pkg', { package: 'pkg', face: 'host', schemas: [{ name: '', schema: zodish }] }))
      .toThrow('missing or empty name')
    expect(() => validateTypertManifest('pkg', { package: 'pkg', face: 'host', schemas: [{ name: 'A', schema: {} }] }))
      .toThrow('not a zod v4 schema instance')
    expect(() => validateTypertManifest('pkg', {
      package: 'pkg',
      face: 'host',
      schemas: [],
      model: { services: [{ key: 'tools', exportName: 'ToolRuntime', tags: [], members: 'x', types: [] }], events: [], objects: [] },
    })).toThrow('service "tools".members must be an array')
  })

  it('validates service, event, object, member, type, and documentation records', () => {
    /** 中文说明：变量 complete 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const complete = completeManifest(zodish)
    expect(validateTypertManifest('pkg', complete)).toBe(complete)

    expect(() => validateTypertManifest('pkg', { ...complete, model: [] }))
      .toThrow('TYPERT.model must be an object')
    expect(() => validateTypertManifest('pkg', { ...complete, model: { ...complete.model, services: [null] } }))
      .toThrow('service must be an object')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: { ...complete.model, services: [{ ...complete.model.services[0], tags: 'bad' }] },
    })).toThrow('service.tags must be an array')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: { ...complete.model, services: [{ ...complete.model.services[0], description: 1 }] },
    })).toThrow('service.description must be a string')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: { ...complete.model, services: [{ ...complete.model.services[0], key: '' }] },
    })).toThrow('service has a missing or empty key')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: { ...complete.model, services: [{ ...complete.model.services[0], members: [null] }] },
    })).toThrow('member must be an object')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: {
        ...complete.model,
        services: [{ ...complete.model.services[0], members: [{ name: 'member', signature: 'member(): void', kind: 1 }] }],
      },
    })).toThrow('has invalid kind')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: {
        ...complete.model,
        services: [{ ...complete.model.services[0], members: [{ name: 'member', signature: 'member(): void', kind: 'future' }] }],
      },
    })).toThrow('has invalid kind')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: { ...complete.model, services: [{ ...complete.model.services[0], types: [null] }] },
    })).toThrow('type must be an object')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: {
        ...complete.model,
        services: [{ ...complete.model.services[0], types: [{ name: 'Type', declaration: '' }] }],
      },
    })).toThrow('type has a missing or empty declaration')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: { ...complete.model, events: [{ ...complete.model.events[0], mode: 1 }] },
    })).toThrow('mode must be a string')
    expect(() => validateTypertManifest('pkg', { ...complete, model: { ...complete.model, objects: [null] } }))
      .toThrow('object must be an object')
    expect(() => validateTypertManifest('pkg', {
      ...complete,
      model: { ...complete.model, objects: [{ ...complete.model.objects[0], exportName: '' }] },
    })).toThrow('object has a missing or empty exportName')
  })

  it('requires and validates strict invocation descriptors', () => {
    /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base = completeManifest(zodish)
    const { invocations: _invocations, ...missingInvocations } = base
    expect(() => validateTypertManifest('pkg', missingInvocations))
      .toThrow('TYPERT.invocations must be an array')

    /** 中文说明：变量 descriptor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const descriptor = strictInvocation()
    /** 中文说明：变量 manifest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = { ...base, invocations: [descriptor] }
    expect(validateTypertManifest('pkg', manifest)).toBe(manifest)
    /** 中文说明：变量 cancellable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellable = { ...descriptor, cancellation: { parameter: 'signal' } }
    expect(validateTypertManifest('pkg', { ...base, invocations: [cancellable] }).invocations)
      .toEqual([cancellable])
    /** 中文说明：变量 scoped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scoped = {
      ...descriptor,
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [{
        name: 'agent',
        wire: 'agentId',
        source: 'lookup',
        lookup: 'agent',
        codec: strictCodec('pkg#AgentId'),
      }, ...descriptor.parameters],
    }
    expect(validateTypertManifest('pkg', { ...base, invocations: [scoped] }).invocations)
      .toEqual([scoped])

    expect(() => validateTypertManifest('pkg', { ...base, invocations: {} }))
      .toThrow('TYPERT.invocations must be an array')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...descriptor, invocation: { kind: 'future' } }],
    })).toThrow('receiver kind must be "direct" or "context"')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...descriptor, result: { mode: 'src-json' } }],
    })).toThrow('result codec must use a strict codec')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...descriptor, cancellation: null }],
    })).toThrow('cancellation must be an object')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...descriptor, cancellation: { parameter: 'abort' } }],
    })).toThrow('cancellation parameter must be "signal"')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...descriptor, result: { mode: 'strict', typeSymbol: 'pkg#Result', schema: zodish } }],
    })).toThrow('result codec is not backed by a zod v4 schema')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{
        ...descriptor,
        parameters: [{ ...descriptor.parameters[0], source: 'future' }],
      }],
    })).toThrow('parameter source must be "json" or "lookup"')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{
        ...descriptor,
        parameters: [{ ...descriptor.parameters[0], source: 'lookup' }],
      }],
    })).toThrow('lookup parameter has a missing or empty lookup')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{
        ...descriptor,
        parameters: [{ ...descriptor.parameters[0], lookup: 'agent' }],
      }],
    })).toThrow('JSON parameter declares a lookup')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{
        ...descriptor,
        parameters: [descriptor.parameters[0], { ...descriptor.parameters[0], name: 'again' }],
      }],
    })).toThrow('repeats wire field "request"')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{
        ...descriptor,
        invocation: {
          kind: 'context',
          context: 'agent',
          wire: 'request',
          codec: strictCodec('pkg#AgentId'),
        },
      }],
    })).toThrow('repeats Context wire field "request"')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...scoped, scope: null }],
    })).toThrow('scope must be an object')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...scoped, scope: { wire: 'agentId' } }],
    })).toThrow('scope has a missing or empty context')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...scoped, scope: { context: 'agent' } }],
    })).toThrow('scope has a missing or empty wire')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{
        ...scoped,
        invocation: {
          kind: 'context',
          context: 'agent',
          wire: 'scopeId',
          codec: strictCodec('pkg#AgentId'),
        },
      }],
    })).toThrow('Context receiver cannot declare a direct scope projection')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...scoped, scope: { context: 'agent', wire: 'missingId' } }],
    })).toThrow('must select its only lookup parameter')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{
        ...scoped,
        parameters: [...scoped.parameters, {
          name: 'other',
          wire: 'otherId',
          source: 'lookup',
          lookup: 'agent',
          codec: strictCodec('pkg#AgentId'),
        }],
      }],
    })).toThrow('must select its only lookup parameter')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...scoped, scope: { context: 'other', wire: 'agentId' } }],
    })).toThrow('must select its only lookup parameter')
    expect(() => validateTypertManifest('pkg', {
      ...base,
      invocations: [{ ...descriptor, sourceLocation: { file: 'src/index.ts', line: 0, column: 1 } }],
    })).toThrow('sourceLocation.line must be a positive integer')
  })
})

/** 中文说明：函数 strictCodec 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function strictCodec(typeSymbol: string) {
  return { mode: 'strict', typeSymbol, schema: z.string() }
}

/** 中文说明：函数 strictInvocation 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function strictInvocation() {
  return {
    id: 'pkg#goals/create',
    service: 'goals',
    namespace: 'goals',
    method: 'create',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: strictCodec('pkg#Request'),
    }],
    result: strictCodec('pkg#Result'),
    sourceLocation: { file: 'src/index.ts', line: 1, column: 1 },
  }
}

/** 中文说明：函数 completeManifest 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function completeManifest(zodish: object) {
  /** 中文说明：变量 member 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const member = { name: 'member', signature: 'member(): void', kind: 'method' }
  /** 中文说明：变量 type 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const type = { name: 'Value', declaration: 'export interface Value {}' }
  return {
    package: 'pkg',
    face: 'host',
    schemas: [{ name: 'Schema', schema: zodish }],
    invocations: [],
    model: {
      services: [{
        key: 'service',
        exportName: 'Service',
        description: 'Service description.',
        summary: 'Service description.',
        jsDoc: '/** Service description. */',
        tags: [],
        members: [member],
        types: [type],
      }],
      events: [
        { name: 'event/with-mode', mode: 'emit', signature: "'event/with-mode'(): void", tags: [] },
        { name: 'event/without-mode', signature: "'event/without-mode'(): void", tags: [] },
      ],
      objects: [{
        name: 'Object',
        exportName: 'Object',
        tags: [],
        members: [member],
        types: [type],
      }],
    },
  }
}
