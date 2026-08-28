#!/usr/bin/env node
/**
 * Pack a Preview deployment from this repository: compose and lower the base
 * image, then write each named fixture overlay and their manifest.
 *
 * Usage: dsh-pack-vfs-image --out <file> [--profile web] [--root /dsh]
 *        node --import tsx/esm src/bin.ts --out ../../apps/web/dist/preview/vfs-image.tar.gz
 * @module @deepseek-ai/dsh-experimental-webworker-packer/src/bin
 * @remarks 文件说明：文件职责：实现 experimental/webworker-packer 中 bin 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-packer 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PREVIEW_FIXTURE_MANIFEST_FILE, PREVIEW_FIXTURE_MANIFEST_VERSION,
  type PreviewFixtureManifest,
} from '@deepseek-ai/dsh-experimental-webworker-runtime'
import { packVfsImage, packVfsOverlay } from './pack.ts'
import {
  composeProfile, configTrees, describePack, indexWorkspacePackages, previewFixtures,
} from './repository.ts'

/**
 * Read one `--flag value` pair.
 * @param name - Flag name without dashes.
 * @param fallback - Value when the flag is absent.
 * @returns The value.
 * @throws When the flag is present with no value, because silently packing the
 * default profile is worse than stopping.
 * @remarks 中文说明：功能说明：处理 flag 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fallback（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 flag(name, fallback)，
 * 并按返回类型处理结果。
 */
function flag(name: string, fallback?: string): string {
  /**
   * 常量说明：index 用于处理 index 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) {
    if (fallback !== undefined) return fallback
    throw new Error(`dsh-pack-vfs-image: --${name} is required`)
  }
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`dsh-pack-vfs-image: --${name} needs a value`)
  }
  return value
}

/**
 * 常量说明：repoRoot 用于处理 repoRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
/**
 * 常量说明：profile 用于处理 profile 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const profile = flag('profile', 'web')
/**
 * 常量说明：out 用于处理 out 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const out = flag('out')
/**
 * 常量说明：outputFile 用于处理 outputFile 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const outputFile = isAbsolute(out) ? out : resolve(process.cwd(), out)

/**
 * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const result = packVfsImage({
  config: composeProfile(repoRoot, profile),
  profile,
  root: flag('root', '/dsh'),
  workspaces: indexWorkspacePackages(repoRoot),
  resolveFrom: repoRoot,
  configTrees: configTrees(repoRoot),
})

if (result.missing.length > 0) {
  throw new Error(`vfs image: ${String(result.missing.length)} dependencies did not resolve; the image would be incomplete`)
}

mkdirSync(dirname(outputFile), { recursive: true })
writeFileSync(outputFile, result.image)

/**
 * 常量说明：fixtureDefinitions 用于处理 fixtureDefinitions 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const fixtureDefinitions = previewFixtures(repoRoot)
/**
 * 常量说明：fixtureDirectory 用于处理 fixtureDirectory 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const fixtureDirectory = join(dirname(outputFile), 'fixtures')
mkdirSync(fixtureDirectory, { recursive: true })
/**
 * 常量说明：fixtureLines 用于处理 fixtureLines 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const fixtureLines: string[] = []
/**
 * 常量说明：fixtures 用于处理 fixtures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：fixture（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(fixture)，并按返回类型处理结果。
 */
const fixtures = fixtureDefinitions.map((fixture) => {
  /**
   * 常量说明：packed 用于处理 packed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const packed = packVfsOverlay(fixture.trees)
  /**
   * 常量说明：file 用于处理 file 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const file = `fixtures/${fixture.id}.tar.gz`
  writeFileSync(join(dirname(outputFile), file), packed.image)
  fixtureLines.push(`  fixture overlay     ${fixture.id} (${String(packed.image.byteLength)} B compressed)`)
  return {
    id: fixture.id,
    label: fixture.label,
    description: fixture.description,
    overlays: [file],
  }
})
/**
 * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const manifest: PreviewFixtureManifest = {
  version: PREVIEW_FIXTURE_MANIFEST_VERSION,
  defaultFixture: fixtures[0]?.id ?? null,
  fixtures,
}
writeFileSync(
  join(dirname(outputFile), PREVIEW_FIXTURE_MANIFEST_FILE),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
process.stdout.write([...describePack(result, repoRoot, outputFile), ...fixtureLines, ''].join('\n'))
