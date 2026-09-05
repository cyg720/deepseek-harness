/** Repository-wide ownership and storage invariants for the recorded-session corpus.
 * @remarks 文件说明：文件职责：实现 仓库维护脚本 中 session snapshot corpus corpus 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 仓库维护脚本 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { existsSync } from 'node:fs'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import {
  assertSessionFixtureVersion,
  captureExpectedWorkspaceSnapshot,
  EMPTY_WORKSPACE_MARKER,
  parseSnapshotManifest,
  parseSessionFixtureName,
  redactSessionSnapshotIds,
  scrubSystemPrompts,
  scrubToolSchemas,
  sessionFixtureFiles,
  sessionFixtureNames,
  type SnapshotManifest,
} from '@deepseek-ai/dsh-session-snapshot'
import { assertV2SnapshotCorpusPolicy } from './session-snapshot-corpus-policy.ts'

/**
 * 常量说明：repoRoot 用于处理 repoRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const repoRoot = resolve(import.meta.dirname, '..')
/**
 * 常量说明：corpusRoot 用于处理 corpusRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const corpusRoot = join(repoRoot, 'snapshots')
/**
 * 常量说明：profiles 用于处理 profiles 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const profiles = ['acp', 'sdk', 'session', 'web'] as const
/**
 * 常量说明：snapshotAdapters 用于处理 snapshotAdapters 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const snapshotAdapters = [
  'apps/web/tests/message-feedback-protocol.snapshot.ts',
  'apps/web/tests/minimal-preset.snapshot.ts',
  'snapshots/acp/acp.snapshot.ts',
  'snapshots/sdk/sdk.snapshot.ts',
  'snapshots/session/headless.snapshot.ts',
] as const

interface Scenario {
  readonly key: string
  readonly profile: string
  readonly name: string
  readonly dir: string
  readonly manifest: SnapshotManifest & {
    composition: string
    recording: 'live' | 'authored'
    header: NonNullable<SnapshotManifest['header']>
  }
}

/**
 * 功能说明：处理 scenarios 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<Scenario[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 scenarios()，并按返回类型处理结果。
 */
async function scenarios(): Promise<Scenario[]> {
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result: Scenario[] = []
  /**
   * 变量说明：profile 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const profile of profiles) {
    /**
     * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const root = join(corpusRoot, profile)
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      /**
       * 常量说明：dir 用于处理 dir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const dir = join(root, entry.name)
      /**
       * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const path = join(dir, 'snapshot.yml')
      expect(existsSync(path), `${profile}/${entry.name}/snapshot.yml`).toBe(true)
      /**
       * 常量说明：manifest 用于处理 manifest 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const manifest = parseSnapshotManifest(await readFile(path, 'utf8'), path)
      expect(manifest.scenario, `${profile}/${entry.name}: scenario`).toBe(entry.name)
      expect(manifest.profile, `${profile}/${entry.name}: profile`).toBe(profile === 'session' ? 'headless' : profile)
      expect(manifest.composition, `${profile}/${entry.name}: composition`).toBeTypeOf('string')
      expect(manifest.recording, `${profile}/${entry.name}: recording`).toMatch(/^(live|authored)$/)
      expect(manifest.header, `${profile}/${entry.name}: header`).toBeDefined()
      result.push({
        key: `${profile}/${entry.name}`,
        profile,
        name: entry.name,
        dir,
        manifest: {
          ...manifest,
          composition: manifest.composition as string,
          recording: manifest.recording as 'live' | 'authored',
          header: manifest.header as NonNullable<SnapshotManifest['header']>,
        },
      })
    }
  }
  return result
}

/**
 * 功能说明：处理 referencedScenario 相关流程；使用场景由所在模块及调用位置决定。
 * @param owner （Scenario）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param source （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 referencedScenario(owner, source)，并按返回类型处理结果。
 */
function referencedScenario(owner: Scenario, source: string): string {
  return source.includes('/') ? source : `${owner.profile}/${source}`
}

/**
 * 功能说明：处理 snapshotNamedTests 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<string[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 snapshotNamedTests()，并按返回类型处理结果。
 */
async function snapshotNamedTests(): Promise<string[]> {
  /**
   * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const files: string[] = []
  /**
   * 常量说明：visit 用于处理 visit 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 visit 相关流程；使用场景由所在模块及调用位置决定。
   * @param directory （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param relativeDir （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 visit(directory, relativeDir)，并按返回类型处理结果。
   */
  const visit = async (directory: string, relativeDir: string): Promise<void> => {
    /**
     * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['dist', 'lib', 'node_modules'].includes(entry.name)) continue
        await visit(join(directory, entry.name), join(relativeDir, entry.name))
      } else if (entry.isFile() && /\.snapshot\.tsx?$/u.test(entry.name)) {
        files.push(join(relativeDir, entry.name).split(/[/\\]/u).join('/'))
      }
    }
  }
  /**
   * 变量说明：root 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const root of ['apps', 'native', 'packages', 'python', 'scripts', 'snapshots', 'website']) {
    await visit(join(repoRoot, root), root)
  }
  return files.sort()
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('reserves the snapshot test suffix for recorded-session adapters', async () => {
  expect(await snapshotNamedTests()).toEqual([...snapshotAdapters])
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('keeps every recorded session owned, pinned, redacted, and header-scrubbed', async () => {
  /**
   * 常量说明：all 用于处理 all 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const all = await scenarios()
  /**
   * 常量说明：byKey 用于处理 byKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：scenario（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(scenario)，并按返回类型处理结果。
   */
  const byKey = new Map(all.map(scenario => [scenario.key, scenario]))
  /**
   * 常量说明：pinByClass 用于处理 pinByClass 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const pinByClass = new Map<string, Scenario>()

  /**
   * 变量说明：scenario 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const scenario of all) {
    if (scenario.manifest.header.pin !== true) continue
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = `${scenario.manifest.composition}/${scenario.manifest.header.class}`
    expect(pinByClass.has(key), `${key}: duplicate header pin`).toBe(false)
    pinByClass.set(key, scenario)
  }

  /**
   * 变量说明：scenario 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const scenario of all) {
    /**
     * 常量说明：manifest、dir、key 用于处理 manifest、dir、key 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { manifest, dir, key } = scenario
    /**
     * 常量说明：classKey 用于处理 classKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const classKey = `${manifest.composition}/${manifest.header.class}`
    expect(pinByClass.has(classKey), `${key}: missing composition/header pin ${classKey}`).toBe(true)

    const localEntries = await readdir(dir)
    const localSessionNames = localEntries.filter(name => parseSessionFixtureName(name) !== undefined)
    if (manifest.session === undefined) {
      expect(localSessionNames.length, `${key}: owner Session fixture`).toBeGreaterThan(0)
    } else {
      expect(localSessionNames, `${key}: borrower must not own a Session fixture`).toEqual([])
      const target = resolve(dir, manifest.session.source)
      expect(existsSync(target), `${key}: session source`).toBe(true)
      /**
       * 常量说明：targetDir 用于处理 targetDir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const targetDir = await realpath(dirname(target))
      /**
       * 常量说明：sourceKey 用于处理 sourceKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const sourceKey = relative(corpusRoot, targetDir).split(/[/\\]/).join('/')
      expect(byKey.has(sourceKey), `${key}: session source must name a corpus owner`).toBe(true)
      expect(byKey.get(sourceKey)?.manifest.session, `${key}: session source cannot chain through a borrower`).toBeUndefined()
      const [selectedParent] = sessionFixtureFiles(await readdir(targetDir))
      expect(basename(target), `${key}: session source must name the owner's selected parent generation`)
        .toBe(selectedParent?.name)
    }

    expect(existsSync(join(dir, 'replay.override.json')), `${key}: replay override presence`)
      .toBe(manifest.replay?.override === true)
    expect(existsSync(join(dir, 'workspace.expected')), `${key}: final workspace presence`)
      .toBe(manifest.workspace?.final === true)
    if (manifest.workspace?.final === true) {
      /**
       * 常量说明：expectedRoot 用于处理 expectedRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const expectedRoot = join(dir, 'workspace.expected')
      /**
       * 常量说明：expectedWorkspace 用于处理 expectedWorkspace 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const expectedWorkspace = await captureExpectedWorkspaceSnapshot(expectedRoot)
      expect(existsSync(join(expectedRoot, EMPTY_WORKSPACE_MARKER)), `${key}: empty workspace marker`)
        .toBe(expectedWorkspace.length === 0)
    }
    expect(existsSync(join(dir, 'input.json')), `${key}: executable input metadata is ACP-only`)
      .toBe(scenario.profile === 'acp')
    if (scenario.profile !== 'acp') {
      expect(existsSync(join(dir, 'stdout.expected.jsonl')), `${key}: ACP transcript outside ACP`).toBe(false)
    }

    if (manifest.header.pin === true) {
      /**
       * 常量说明：promptSource 用于处理 promptSource 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const promptSource = byKey.get(referencedScenario(scenario, manifest.header.systemPromptSource ?? scenario.name))
      /**
       * 常量说明：schemaSource 用于处理 schemaSource 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const schemaSource = byKey.get(referencedScenario(scenario, manifest.header.toolSchemasSource ?? scenario.name))
      expect(promptSource, `${key}: system-prompt source`).toBeDefined()
      expect(schemaSource, `${key}: tool-schema source`).toBeDefined()
      expect(existsSync(join((promptSource as Scenario).dir, 'system-prompt.expected.md')), `${key}: system-prompt sidecar`).toBe(true)
      expect(existsSync(join((schemaSource as Scenario).dir, 'tool-schemas.expected.json')), `${key}: tool-schema sidecar`).toBe(true)
      /**
       * 变量说明：field、source 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */
      for (const [field, source] of [
        ['system-prompt.expected.md', promptSource],
        ['tool-schemas.expected.json', schemaSource],
      ] as const) {
        /**
         * 常量说明：local 用于处理 local 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const local = join(dir, field)
        if (!existsSync(local) || !(await lstat(local)).isSymbolicLink()) continue
        expect(await realpath(local), `${key}: ${field} symlink follows its manifest source`)
          .toBe(await realpath(join((source as Scenario).dir, field)))
      }
    }

    if (manifest.session !== undefined) continue
    const names = sessionFixtureNames(localEntries)
    const fixtures = await Promise.all(names.map(name => readFile(join(dir, name), 'utf8')))
    for (const name of localSessionNames) {
      assertSessionFixtureVersion(name, await readFile(join(dir, name), 'utf8'))
    }
    expect(redactSessionSnapshotIds(fixtures), `${key}: typed identity fixed point`).toEqual(fixtures)
    /**
     * 变量说明：index、fixture 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [index, fixture] of fixtures.entries()) {
      expect(scrubSystemPrompts(fixture), `${key}/${names[index]}: system prompt must be a sidecar`).toBe(fixture)
      expect(scrubToolSchemas(fixture), `${key}/${names[index]}: tool schemas must be a sidecar`).toBe(fixture)
    }
    /**
     * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const index of manifest.header.childSystemPrompts ?? []) {
      expect(names[index], `${key}: child prompt index ${index}`).toBeDefined()
      expect(existsSync(join(dir, `system-prompt.${index}.expected.md`)), `${key}: child prompt sidecar ${index}`).toBe(true)
    }
    /**
     * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const index of manifest.header.childToolSchemas ?? []) {
      expect(names[index], `${key}: child schema index ${index}`).toBeDefined()
      expect(existsSync(join(dir, `tool-schemas.${index}.expected.json`)), `${key}: child schema sidecar ${index}`).toBe(true)
    }
  }
})

it('keeps a current v2 majority plus the bounded declared v0/v1 migration corpus', async () => {
  expect(SESSION_FORMAT_VERSION).toBe(2)
  const owners = (await scenarios()).filter(scenario => scenario.manifest.session === undefined)
  const inventory = await Promise.all(owners.map(async scenario => ({
    key: scenario.key,
    selectedVersions: sessionFixtureFiles(await readdir(scenario.dir)).map(file => file.version),
    ...(scenario.manifest.sessionFormat === undefined
      ? {}
      : { retained: scenario.manifest.sessionFormat }),
  })))

  expect(assertV2SnapshotCorpusPolicy(inventory)).toMatchObject({
    retainedRoles: 7,
    retainedScenarios: 5,
  })
})
