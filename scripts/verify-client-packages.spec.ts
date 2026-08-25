/** Tests for client package modes, dependency sections, and module requests. */
/*
 * 文件职责：验证 verify-client-packages.spec.ts 覆盖的仓库规范、文档、包或运行时门禁职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST、Git 或依赖图分析。
 * 产品维度：保障源码、配置、文档和发布包满足项目约定，阻止不完整变更进入主分支。
 * 逻辑维度：扫描仓库输入，构建检查模型，收集违规项，再输出诊断并设置退出状态。
 * 关键边界：被检查文本与路径不可信；门禁结果必须确定；任何违规都应显式失败。
 * 新手阅读建议：先看规则入口和扫描范围，再读违规收集，最后关注例外、诊断和退出码。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectClientPackageViolations,
  collectRuntimeSourcePackageUses,
  collectSourcePackageUses,
  fixClientPackageManifests,
  readClientDeclarations,
  /** 中文说明：type ClientDeclaration 定义本测试所需的数据或行为，用于表达仓库门禁场景。 */
  type ClientDeclaration,
  /** 中文说明：type ClientPackage 定义本测试所需的数据或行为，用于表达仓库门禁场景。 */
  type ClientPackage,
  /** 中文说明：type ClientPackageFacts 定义本测试所需的数据或行为，用于表达仓库门禁场景。 */
  type ClientPackageFacts,
} from './verify-client-packages.ts'

/** 中文说明：常量 CORDIS 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CORDIS = '@deepseek-ai/cordis'
/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []

afterEach(() => {
  /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 declaration 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function declaration(
  short: string,
  fields: Partial<Omit<ClientDeclaration, 'name' | 'manifest'>> = {},
): ClientDeclaration {
  return {
    name: short.startsWith('@') ? short : '@deepseek-ai/dsh-client-' + short,
    manifest: 'packages/client/' + short.replace(/^.*\//, '') + '/package.json',
    dynamic: true,
    external: [],
    inject: [],
    ...fields,
  }
}

/** 中文说明：函数 pkg 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function pkg(
  short: string,
  fields: Partial<Omit<ClientPackage, 'name' | 'manifest'>> = {},
): ClientPackage {
  return {
    ...declaration(short),
    staticLinked: false,
    sourceUses: {},
    runtimeSourceUses: {},
    dependencies: {},
    peerDependencies: { [CORDIS]: 'workspace:^' },
    devDependencies: { [CORDIS]: 'workspace:^' },
    ...fields,
  }
}

/** 中文说明：函数 facts 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function facts(
  packages: readonly ClientPackage[],
  options: Partial<Omit<ClientPackageFacts, 'packages'>> = {},
): ClientPackageFacts {
  return {
    packages,
    declarations: options.declarations ?? packages,
    staticLinkedPackages: options.staticLinkedPackages ?? new Set(
      packages.filter(item => item.staticLinked).map(item => item.name),
    ),
    platformModules: options.platformModules ?? [],
    preloadedExternals: options.preloadedExternals ?? [],
    parserPreloadIds: options.parserPreloadIds
      ?? (options.preloadedExternals ?? []).map(value => value.replace(/\/client$/, '')),
    malformed: options.malformed ?? [],
  }
}

describe('source package uses', () => {
  it('counts type imports, module augmentations, dynamic imports, and JSX', () => {
    /** 中文说明：变量 uses 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const uses = collectSourcePackageUses('feature.tsx', [
      "import type { A } from '@deepseek-ai/dsh-a/subpath'",
      "declare module '@deepseek-ai/dsh-client-ui-slots' {}",
      "const load = () => import('@deepseek-ai/dsh-b')",
      'export const view = <div />',
      "export type { Local } from './local.ts'",
    ].join('\n'))

    expect([...uses].sort()).toEqual([
      '@deepseek-ai/dsh-a',
      '@deepseek-ai/dsh-b',
      '@deepseek-ai/dsh-client-ui-slots',
      'react',
    ])
    expect([...collectRuntimeSourcePackageUses('feature.tsx', [
      "import type { A } from '@deepseek-ai/dsh-a/subpath'",
      "declare module '@deepseek-ai/dsh-client-ui-slots' {}",
      "const load = () => import('@deepseek-ai/dsh-b')",
      'export const view = <div />',
    ].join('\n'))].sort()).toEqual([
      '@deepseek-ai/dsh-b',
      'react',
    ])
  })
})

describe('package modes', () => {
  it('accepts one dynamic package and one statically linked package', () => {
    /** 中文说明：变量 dynamic 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dynamic = pkg('runtime')
    /** 中文说明：变量 shell 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shell = pkg('ui-slots', { dynamic: false, staticLinked: true })
    expect(collectClientPackageViolations(facts([dynamic, shell]))).toEqual([])
  })

  it('rejects a package with both modes or neither mode', () => {
    /** 中文说明：变量 both 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const both = pkg('both', { staticLinked: true })
    /** 中文说明：变量 neither 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const neither = pkg('neither', { dynamic: false })
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = collectClientPackageViolations(facts([both, neither]))
    expect(found).toHaveLength(2)
    expect(found.join('\n')).toContain('must be dynamic or statically linked, not both')
    expect(found.join('\n')).toContain('has no supported client package mode')
  })

  it('requires seeded workspace packages to use staticLinked and preloads to name dynamic rows', () => {
    /** 中文说明：变量 slots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slots = declaration('ui-slots', { dynamic: false })
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = declaration('runtime', { dynamic: false })
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = collectClientPackageViolations(facts([], {
      declarations: [slots, runtime],
      platformModules: [slots.name],
      preloadedExternals: [runtime.name + '/client'],
    }))
    expect(found).toHaveLength(2)
    expect(found.join('\n')).toContain('does not use the staticLinked preset')
    expect(found.join('\n')).toContain('has no dynamic dsh.client row')
  })

  it('requires every preloaded external to have a parser preload row', () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = declaration('runtime')
    expect(collectClientPackageViolations(facts([], {
      declarations: [runtime],
      preloadedExternals: [runtime.name + '/client'],
      parserPreloadIds: [],
    }))).toEqual([
      'packages/client/web/src/platform.ts: parser-preloaded external '
      + '"@deepseek-ai/dsh-client-runtime/client" has no matching PARSER_PRELOAD_IDS row in '
      + 'packages/client/modules/src/index.ts',
    ])
  })
})

describe('dependency sections', () => {
  it('accepts dynamic peer plus dev relationships, static dev inputs, and private dependencies', () => {
    /** 中文说明：变量 slots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slots = pkg('ui-slots', { dynamic: false, staticLinked: true })
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = pkg('runtime', {
      inject: ['@deepseek-ai/dsh-client-feature'],
      sourceUses: {
        '@deepseek-ai/dsh-agent': ['packages/client/runtime/src/index.ts'],
        '@deepseek-ai/dsh-client-ui-slots': ['packages/client/runtime/src/client/slots.ts'],
        react: ['packages/client/runtime/src/client/view.tsx'],
      },
      dependencies: { immer: '^10.1.1' },
      peerDependencies: {
        [CORDIS]: 'workspace:^',
        '@deepseek-ai/dsh-agent': 'workspace:^',
        '@deepseek-ai/dsh-client-feature': 'workspace:^',
      },
      devDependencies: {
        [CORDIS]: 'workspace:^',
        '@deepseek-ai/dsh-agent': 'workspace:^',
        '@deepseek-ai/dsh-client-feature': 'workspace:^',
        '@deepseek-ai/dsh-client-ui-slots': 'workspace:^',
        react: '^18.2.0',
      },
    })
    expect(collectClientPackageViolations(facts([slots, runtime], {
      platformModules: ['react', slots.name],
    }))).toEqual([])
  })

  it('rejects internal dependencies, static peers, and mismatched peer development ranges', () => {
    /** 中文说明：变量 slots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slots = pkg('ui-slots', { dynamic: false, staticLinked: true })
    /** 中文说明：变量 subject 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const subject = pkg('feature', {
      sourceUses: {
        '@deepseek-ai/dsh-agent': ['packages/client/feature/src/index.ts'],
        [slots.name]: ['packages/client/feature/src/view.tsx'],
      },
      dependencies: { '@deepseek-ai/dsh-agent': 'workspace:^' },
      peerDependencies: { [CORDIS]: 'workspace:^', [slots.name]: 'workspace:^' },
      devDependencies: { [CORDIS]: 'workspace:^', [slots.name]: 'workspace:*' },
    })
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = collectClientPackageViolations(facts([slots, subject]))
    expect(found).toHaveLength(2)
    expect(found.join('\n')).toContain('peer-installed DSH relationship')
    expect(found.join('\n')).toContain('static client input')
  })

  it('requires every peer to have the same development range', () => {
    /** 中文说明：变量 subject 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const subject = pkg('feature', {
      peerDependencies: { [CORDIS]: 'workspace:^', '@deepseek-ai/cordis-plugin-loader': 'workspace:^' },
    })
    expect(collectClientPackageViolations(facts([subject]))).toEqual([
      'packages/client/feature/package.json: peerDependencies.@deepseek-ai/cordis-plugin-loader'
      + ' is workspace:^, so devDependencies.@deepseek-ai/cordis-plugin-loader must use the same range;'
      + ' found no declaration',
    ])
  })

  it('requires statically linked third-party runtime imports in dependencies', () => {
    /** 中文说明：变量 primitives 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const primitives = pkg('ui-primitives', {
      dynamic: false,
      staticLinked: true,
      runtimeSourceUses: { shiki: ['packages/client/ui-primitives/src/highlight.ts'] },
      devDependencies: { [CORDIS]: 'workspace:^', shiki: '^4.3.1' },
    })
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = collectClientPackageViolations(facts([primitives]))
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('runtime import retained by a statically linked artifact')
    expect(found[0]).toContain('declare it only in dependencies')

    /** 中文说明：变量 valid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const valid = { ...primitives, dependencies: { shiki: '^4.3.1' }, devDependencies: { [CORDIS]: 'workspace:^' } }
    expect(collectClientPackageViolations(facts([valid]))).toEqual([])
  })

  it('keeps the web shell runtime inputs development-only', () => {
    /** 中文说明：变量 web 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const web = pkg('web', {
      dynamic: false,
      staticLinked: true,
      runtimeSourceUses: {
        '@deepseek-ai/cordis-plugin-loader': ['packages/client/web/src/boot.ts'],
        react: ['packages/client/web/src/seed.ts'],
      },
      devDependencies: {
        [CORDIS]: 'workspace:^',
        '@deepseek-ai/cordis-plugin-loader': 'workspace:^',
        react: '^18.2.0',
      },
    })
    expect(collectClientPackageViolations(facts([web]))).toEqual([])
  })

  it('allows npm dependency cycles', () => {
    /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const a = pkg('a', {
      peerDependencies: { [CORDIS]: 'workspace:^', '@deepseek-ai/dsh-client-b': 'workspace:^' },
      devDependencies: { [CORDIS]: 'workspace:^', '@deepseek-ai/dsh-client-b': 'workspace:^' },
    })
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = pkg('b', {
      peerDependencies: { [CORDIS]: 'workspace:^', '@deepseek-ai/dsh-client-a': 'workspace:^' },
      devDependencies: { [CORDIS]: 'workspace:^', '@deepseek-ai/dsh-client-a': 'workspace:^' },
    })
    expect(collectClientPackageViolations(facts([a, b]))).toEqual([])
  })
})

describe('module requests', () => {
  it('accepts a dynamic row supplier and its client subpath', () => {
    /** 中文说明：变量 ui 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ui = declaration('ui', { external: ['@deepseek-ai/dsh-client-slots/client'] })
    /** 中文说明：变量 slots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slots = declaration('slots')
    expect(collectClientPackageViolations(facts([], { declarations: [ui, slots] }))).toEqual([])
  })

  it('rejects an explicit baseline request', () => {
    /** 中文说明：变量 ui 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ui = declaration('ui', { external: ['react'] })
    expect(collectClientPackageViolations(facts([], {
      declarations: [ui],
      platformModules: ['react'],
    }))).toEqual([
      ui.manifest + ': dsh.client.external repeats baseline module "react"; remove the explicit declaration',
    ])
  })

  it('rejects duplicates, empty values, self-requests, and missing suppliers', () => {
    /** 中文说明：变量 ui 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ui = declaration('ui', {
      external: ['', '@deepseek-ai/dsh-client-ui', '@deepseek-ai/dsh-missing', '@deepseek-ai/dsh-missing'],
      inject: ['', '@deepseek-ai/dsh-a', '@deepseek-ai/dsh-a'],
    })
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = collectClientPackageViolations(facts([], { declarations: [ui] }))
    expect(found).toHaveLength(6)
    expect(found.join('\n')).toContain('dsh.client.external contains an empty value')
    expect(found.join('\n')).toContain('dsh.client.inject contains an empty value')
    expect(found.join('\n')).toContain('names its own row')
    expect(found.join('\n')).toContain('has no supplier')
  })

  it('rejects synchronous module-request cycles but ignores inject cycles', () => {
    /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const a = declaration('a', {
      external: ['@deepseek-ai/dsh-client-b'],
      inject: ['@deepseek-ai/dsh-client-b'],
    })
    /** 中文说明：变量 b 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const b = declaration('b', {
      external: ['@deepseek-ai/dsh-client-a'],
      inject: ['@deepseek-ai/dsh-client-a'],
    })
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = collectClientPackageViolations(facts([], { declarations: [a, b] }))
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('synchronous dsh.client.external cycle')
  })
})

describe('manifest declarations', () => {
  it('reports malformed arrays without hiding other packages', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'client-packages-'))
    roots.push(root)
    /** 中文说明：变量 files 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const files: Record<string, unknown> = {
      'packages/g/a/package.json': {
        name: '@f/a', dsh: { client: { external: 'react', inject: ['@f/b', 1] } },
      },
      'packages/g/b/package.json': { name: '@f/b', dsh: { client: {} } },
    }
    /** 中文说明：该循环依次处理仓库文件或违规项；循环变量仅在当前循环中有效。 */
    for (const [path, value] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), JSON.stringify(value))
    }

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = readClientDeclarations(root)
    expect(result.declarations).toHaveLength(2)
    expect(result.malformed).toEqual([
      'packages/g/a/package.json: @f/a dsh.client.external must be a string array',
      'packages/g/a/package.json: @f/a dsh.client.inject must be a string array',
    ])
  })

  it('fixes unambiguous dependency sections and declaration entries', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'client-packages-fix-'))
    roots.push(root)
    /** 中文说明：变量 subject 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const subject = pkg('feature', {
      external: ['', 'react', '@deepseek-ai/dsh-client-feature', '@deepseek-ai/dsh-missing'],
      inject: ['', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-agent'],
      sourceUses: {
        '@deepseek-ai/dsh-agent': ['packages/client/feature/src/index.ts'],
        '@deepseek-ai/dsh-client-ui-slots': ['packages/client/feature/src/view.tsx'],
      },
      dependencies: {
        [CORDIS]: 'workspace:^',
        '@deepseek-ai/dsh-agent': 'workspace:*',
      },
      peerDependencies: {
        '@deepseek-ai/dsh-client-ui-slots': 'workspace:^',
        '@deepseek-ai/cordis-plugin-loader': 'workspace:^',
      },
      devDependencies: {},
    })
    /** 中文说明：变量 slots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slots = declaration('ui-slots', { dynamic: false })
    /** 中文说明：变量 manifest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manifest = {
      name: subject.name,
      dsh: { client: { external: subject.external, inject: subject.inject, platform: 'web' } },
      dependencies: subject.dependencies,
      peerDependencies: subject.peerDependencies,
      devDependencies: subject.devDependencies,
    }
    mkdirSync(dirname(join(root, subject.manifest)), { recursive: true })
    writeFileSync(join(root, subject.manifest), JSON.stringify(manifest))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }))

    expect(fixClientPackageManifests(root, facts([subject], {
      declarations: [subject, slots],
      staticLinkedPackages: new Set([slots.name]),
      platformModules: ['react', slots.name],
    }))).toEqual([subject.manifest])

    /** 中文说明：变量 fixed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fixed = JSON.parse(readFileSync(join(root, subject.manifest), 'utf8')) as {
      dsh: { client: { external: string[]; inject: string[] } }
      dependencies?: Record<string, string>
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(fixed.dsh.client).toMatchObject({
      external: ['@deepseek-ai/dsh-missing'],
      inject: ['@deepseek-ai/dsh-agent'],
    })
    expect(fixed.dependencies).toBeUndefined()
    expect(fixed.peerDependencies).toEqual({
      '@deepseek-ai/cordis-plugin-loader': 'workspace:^',
      [CORDIS]: 'workspace:^',
      '@deepseek-ai/dsh-agent': 'workspace:*',
    })
    expect(fixed.devDependencies).toEqual({
      '@deepseek-ai/dsh-client-ui-slots': 'workspace:^',
      [CORDIS]: 'workspace:^',
      '@deepseek-ai/dsh-agent': 'workspace:*',
      '@deepseek-ai/cordis-plugin-loader': 'workspace:^',
    })
  })

  it('fixes a statically linked runtime import into dependencies', () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'client-packages-static-fix-'))
    roots.push(root)
    /** 中文说明：变量 subject 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const subject = pkg('ui-primitives', {
      dynamic: false,
      staticLinked: true,
      runtimeSourceUses: { shiki: ['packages/client/ui-primitives/src/highlight.ts'] },
      devDependencies: { [CORDIS]: 'workspace:^', shiki: '^4.3.1' },
    })
    mkdirSync(dirname(join(root, subject.manifest)), { recursive: true })
    writeFileSync(join(root, subject.manifest), JSON.stringify({
      name: subject.name,
      peerDependencies: subject.peerDependencies,
      devDependencies: subject.devDependencies,
    }))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }))

    expect(fixClientPackageManifests(root, facts([subject]))).toEqual([subject.manifest])
    /** 中文说明：变量 fixed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fixed = JSON.parse(readFileSync(join(root, subject.manifest), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(fixed.dependencies).toEqual({ shiki: '^4.3.1' })
    expect(fixed.devDependencies).toEqual({ [CORDIS]: 'workspace:^' })
  })
})
