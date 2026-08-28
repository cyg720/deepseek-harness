/**
 * 文件职责：验证 dev-web.spec.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { TsdownBundle } from 'tsdown'
import { writeClientBuildRecord } from './client-build-environment.ts'
import {
  devWebBuildEnvironment,
  discoverLibraryDirs,
  discoverPluginDirs,
  watchClientPlugins,
} from './dev-web.ts'

it('samples one local environment at startup without validating watcher outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-dev-web-environment-'))
  try {
    await mkdir(join(root, 'apps/web/dist'), { recursive: true })
    await mkdir(join(root, 'packages/client/example/lib'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    await writeFile(join(root, 'apps/web/dist/index.html'), '<main></main>')
    await writeFile(join(root, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
    writeClientBuildRecord(root, {
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: 'fffffff',
      DSH_CLIENT_TITLE: 'DeepSeek Harness',
      DSH_CLIENT_VERSION: '1.2.2',
    })
    await writeFile(join(root, 'packages/client/example/lib/client.js'), 'module.exports = { changed: true }\n')

    expect(devWebBuildEnvironment(root, {
      PATH: '/bin',
      DSH_BUILD_CLIENT_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: 'abc1234',
      DSH_CLIENT_EXTRA: 'launch-value',
    })).toEqual({
      PATH: '/bin',
      DSH_CLIENT_COMMIT_HASH: 'abc1234',
      DSH_CLIENT_EXTRA: 'launch-value',
      DSH_CLIENT_VERSION: '1.2.3',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('discovers dsh.client packages with sibling roles', async () => {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = await mkdtemp(join(tmpdir(), 'dsh-dev-web-discovery-'))
  try {
    /** 中文说明：变量 current 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const current = join(root, 'packages', 'client', 'current')
    await mkdir(current, { recursive: true })
    await writeFile(join(current, 'package.json'), JSON.stringify({
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web' },
        profile: { bundles: [] },
      },
    }))

    expect(discoverPluginDirs(root)).toEqual(['packages/client/current'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('discovers client-preset packages the shell links, excluding loader-delivered and test infrastructure', async () => {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = await mkdtemp(join(tmpdir(), 'dsh-dev-web-library-'))
  try {
    /** 中文说明：函数值 write 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const write = async (dir: string, manifest: unknown, config: string): Promise<void> => {
      await mkdir(join(root, dir), { recursive: true })
      await writeFile(join(root, dir, 'package.json'), JSON.stringify(manifest))
      await writeFile(join(root, dir, 'tsdown.config.ts'), config)
    }
    /** 中文说明：变量 clientPreset 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const clientPreset = "import { clientLibrary } from '../tsdown.client.ts'\nexport default clientLibrary('x', [])\n"

    // Linked by the compile shell: client preset, no loader-delivered half.
    await write('packages/client/linked', {}, clientPreset)
    // Loader-delivered: discoverPluginDirs owns it, so it must not appear twice.
    await write('packages/client/delivered', { dsh: { client: { platform: 'web' } } }, clientPreset)
    // Test infrastructure builds through the preset but never enters the shell graph.
    await write('packages/test-support/harness', {}, clientPreset)
    // Host package with its own config: not a client-face build at all.
    await write('packages/host/server', {}, "import { defineConfig } from 'tsdown'\nexport default defineConfig({})\n")

    expect(discoverLibraryDirs(root)).toEqual(['packages/client/linked'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rebuilds a client-plugin bundle after its source changes', async () => {
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = await mkdtemp(join(tmpdir(), 'dsh-dev-web-watch-'))
  /** 中文说明：变量 bundles 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let bundles: TsdownBundle[] = []
  try {
    await symlink(join(import.meta.dirname, '..', 'node_modules'), join(root, 'node_modules'), 'dir')
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@dsh-test/dev-web-watch', private: true, type: 'module' }))
    await writeFile(join(root, 'tsdown.config.ts'), `
import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: { client: 'src.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false,
  outputOptions: { entryFileNames: 'client.js' },
})
`)
    /** 中文说明：变量 sourcePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sourcePath = join(root, 'src.ts')
    /** 中文说明：变量 bundlePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundlePath = join(root, 'lib/client.js')
    await writeFile(sourcePath, 'export const version = "watch-v1"\n')
    bundles = await watchClientPlugins(root, ['.'], 50)
    expect(await readFile(bundlePath, 'utf8')).toContain('watch-v1')

    await new Promise(resolve => setTimeout(resolve, 1_000))
    await writeFile(sourcePath, `export const version = "watch-v2-${'x'.repeat(100)}"\n`)
    await expect.poll(async () => (await readFile(bundlePath, 'utf8')).includes('watch-v2-'), {
      timeout: 10_000,
    }).toBe(true)
  } finally {
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
