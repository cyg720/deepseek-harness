import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { FileSystem, FsError, FsVersion, type FsDirEntry, type FsEditOutcome, type FsEditRequest, type FsInfo, type FsPathInfo, type FsTarget, type FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import * as SkillFileSystem from '../src/index.ts'

/** Every temp dir created by this file, removed after each test. */
const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(name: string): Promise<string> {
  const dir = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), `dsh-${name}-`)))
  tempDirs.push(dir)
  return dir
}

/** 中文说明：函数 writeSkill 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function writeSkill(root: string, name: string, description: string, body = 'Use the skill.'): Promise<void> {
  /** 中文说明：变量 dir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

/** 中文说明：函数 writeFlatSkill 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function writeFlatSkill(root: string, name: string, description: string, body = 'Flat body.'): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

/** 中文说明：class TestFileSystem 定义本测试所需的数据或行为，用于表达技能发现与装载场景。 */
class TestFileSystem extends FileSystem {
  listDirCalls = 0
  failResolvePaths = new Set<string>()
  failStatPaths = new Set<string>()
  failListDirPaths = new Set<string>()
  errorResolvePaths = new Set<string>()
  errorStatPaths = new Set<string>()
  errorReadPaths = new Set<string>()
  missingReadPaths = new Set<string>()
  statOverrides = new Map<string, FsInfo | undefined>()
  statSignals: Array<AbortSignal | undefined> = []
  readTextSignals: Array<AbortSignal | undefined> = []
  readTextOverride?: (target: FsTarget, signal?: AbortSignal) => Promise<string>

  override async resolve(path: string): Promise<FsTarget> {
    if (this.failResolvePaths.has(path)) throw new FsError('resolve failed', 'FS_NOT_FOUND')
    if (this.errorResolvePaths.has(path)) throw new Error('resolve temporarily failed')
    return { targetKey: path as never, displayPath: path }
  }

  override processPath(target: FsTarget): string { return String(target.targetKey) }

  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.targetKey === parent.targetKey || String(child.targetKey).startsWith(`${parent.targetKey}/`)
  }

  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    this.statSignals.push(signal)
    if (this.failStatPaths.has(target.displayPath)) throw new FsError('stat failed', 'FS_NOT_FOUND')
    if (this.errorStatPaths.has(target.displayPath)) throw new Error('stat temporarily failed')
    if (this.statOverrides.has(target.displayPath)) return this.statOverrides.get(target.displayPath)
    try {
      /** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fs = await import('node:fs/promises')
      /** 中文说明：变量 info 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const info = await fs.stat(target.displayPath)
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async lstat(path: string): Promise<FsPathInfo | undefined> {
    try {
      /** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fs = await import('node:fs/promises')
      /** 中文说明：变量 info 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const info = await fs.lstat(path)
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    this.readTextSignals.push(signal)
    if (this.readTextOverride !== undefined) return await this.readTextOverride(target, signal)
    if (this.missingReadPaths.has(target.displayPath)) throw new FsError('read failed', 'FS_NOT_FOUND')
    if (this.errorReadPaths.has(target.displayPath)) throw new Error('read temporarily failed')
    /** 中文说明：变量 text 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const text = await readFile(target.displayPath, 'utf8')
    if (text.includes('\uFFFD')) throw new FsError('not text', 'FS_NOT_TEXT')
    return text
  }

  override async streamText(_target: FsTarget): Promise<AsyncIterable<string>> {
    throw new Error('not needed in skill tests')
  }

  override async readBytes(_target: FsTarget, _signal: AbortSignal | undefined, _maxBytes: number): Promise<Uint8Array> {
    throw new Error('not needed in skill tests')
  }

  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    this.listDirCalls += 1
    if (this.failListDirPaths.has(target.displayPath)) throw new Error('list temporarily failed')
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries = await readdir(target.displayPath, { withFileTypes: true, encoding: 'utf8' })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result: FsDirEntry[] = []
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      /** 中文说明：变量 childPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const childPath = join(target.displayPath, entry.name)
      /** 中文说明：变量 type 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let type: FsInfo['type'] = 'other'
      /** 中文说明：变量 size 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let size: number | undefined
      try {
        /** 中文说明：变量 info 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const info = await stat(childPath)
        type = info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other'
        size = info.isFile() ? info.size : undefined
      } catch {
        type = 'other'
      }
      result.push({
        name: entry.name,
        type,
        target: { targetKey: childPath as never, displayPath: childPath },
        version: FsVersion('test'),
        ...(size !== undefined ? { size } : {}),
      })
    }
    return result
  }

  override async writeText(target: FsTarget, content: string): Promise<FsWriteOutcome> {
    await mkdir(dirname(target.displayPath), { recursive: true })
    await writeFile(target.displayPath, content)
    return { operation: 'create', version: FsVersion('test'), before: null, after: content }
  }

  override async editText(_target: FsTarget, _request: FsEditRequest): Promise<FsEditOutcome> {
    throw new Error('not needed in skill tests')
  }
}

/** 中文说明：函数 setupLocal 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setupLocal(home: string, config: Partial<SkillFileSystem.Config> = {}): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    watch: false,
    ...config,
  })
  return ctx
}

/** 中文说明：函数 waitFor 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  /** 中文说明：变量 deadline 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const deadline = Date.now() + 5000
  while (true) {
    /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error('timed out waiting for watcher state')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('dsh-skill-filesystem plugin exports', () => {
  it('declares stable plugin metadata', () => {
    expect(SkillFileSystem.name).toBe('skill-filesystem')
    expect(SkillFileSystem.inject).toEqual(['skills'])
  })
})

describe('FileSystemSkillProvider', () => {
  it('discovers project, custom, user, and agents skill roots in priority order', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-home')
    /** 中文说明：变量 project 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const project = await tempDir('skill-project')
    /** 中文说明：变量 custom 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const custom = await tempDir('skill-custom')
    await mkdir(join(project, '.git'), { recursive: true })

    await writeSkill(join(home, '.agents/skills'), 'same', 'user agents skill')
    await writeSkill(join(home, '.dsh/skills'), 'same', 'user dsh skill')
    await writeSkill(custom, 'same', 'custom skill')
    await writeSkill(join(project, '.agents/skills'), 'same', 'project agents skill')
    await writeSkill(join(project, '.dsh/skills'), 'same', 'project dsh skill')
    await writeSkill(custom, 'custom-only', 'custom only')
    await writeSkill(join(home, '.dsh/skills/.system'), 'hidden-system', 'hidden system')

    /** 中文说明：变量 bundled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundled = await tempDir('skill-bundled')
    await writeSkill(bundled, 'bundled-only', 'bundled skill')
    await writeSkill(bundled, 'same', 'bundled skill')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home, { customSkillDirs: [custom], bundledSkillDir: bundled })

    /** 中文说明：变量 skills 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const skills = await ctx.skills.list({ cwd: join(project, 'src') })
    expect(skills.map(skill => skill.name)).toEqual([
      'bundled-only',
      'custom-only',
      'same',
    ])
    expect(skills.find(skill => skill.name === 'custom-only')?.description).toBe('custom only')
    expect(skills.find(skill => skill.name === 'same')?.description).toBe('project dsh skill')
    expect(skills.find(skill => skill.name === 'same')?.source).toBe('project-dsh')
    expect(skills.find(skill => skill.name === 'hidden-system')).toBeUndefined()
    expect(skills.find(skill => skill.name === 'bundled-only')).toMatchObject({ source: 'bundled' })
    expect((await ctx.skills.get('bundled-only'))?.content).toBe('Use the skill.')

    /** 中文说明：变量 noGit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const noGit = await tempDir('skill-no-git')
    await writeSkill(join(noGit, '.dsh/skills'), 'fallback-root', 'Fallback root')
    expect((await ctx.skills.list({ cwd: noGit })).map(skill => skill.name)).toContain('fallback-root')
  })

  it('lets project skills override runtime while runtime overrides custom and user skills', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-runtime-priority')
    /** 中文说明：变量 project 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const project = await tempDir('skill-runtime-project')
    /** 中文说明：变量 custom 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const custom = await tempDir('skill-runtime-custom')
    await mkdir(join(project, '.git'), { recursive: true })

    await writeSkill(join(project, '.dsh/skills'), 'project-name', 'Project wins')
    await writeSkill(custom, 'runtime-name', 'Custom loses')
    await writeSkill(join(home, '.dsh/skills'), 'runtime-name', 'User loses')

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home, { customSkillDirs: [custom] })
    ctx.skills.register({
      name: 'project-name',
      description: 'Runtime loses to project',
      content: 'Runtime body.',
      source: 'runtime',
    })
    ctx.skills.register({
      name: 'runtime-name',
      description: 'Runtime wins',
      content: 'Runtime body.',
      source: 'runtime',
    })

    expect((await ctx.skills.get('project-name', { cwd: project }))?.description).toBe('Project wins')
    expect((await ctx.skills.get('runtime-name', { cwd: project }))?.description).toBe('Runtime wins')
  })

  it('parses flat skills and filters invalid skills from the invocation-neutral listing', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-flat')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeFlatSkill(root, 'flat-skill', 'flat description', 'Flat instructions.')
    await writeFile(join(root, 'rich-skill.md'), [
      '---',
      'name: rich-skill',
      'description: rich description',
      'whenToUse: For richer local parsing',
      'disable-model-invocation: off',
      'user-invocable: YES',
      'metadata:',
      '  owner: tests',
      '---',
      '',
      'Rich body.',
    ].join('\n'))
    await writeFile(join(root, 'bad.md'), '---\nname: Bad_Name\ndescription: bad\n---\n\nbad')
    await writeFile(join(root, 'missing-description.md'), '---\nname: missing-description\n---\n\nbad')
    await writeFile(join(root, 'no-frontmatter.md'), 'No frontmatter.')
    await writeFile(join(root, 'plain-markdown.md'), '# Notes\nNot a skill.')
    await writeFile(join(root, 'open-frontmatter.md'), '---\nname: open-frontmatter')
    await writeFile(join(root, 'non-object.md'), '---\n[]\n---\n\nbad')
    await writeFile(join(root, 'no-trailing-body.md'), '---\nname: no-trailing-body\ndescription: No trailing body\n---')
    await writeFile(join(root, 'notes.txt'), 'ignored')
    await mkdir(join(root, 'not-a-skill'), { recursive: true })
    await writeSkill(root, 'user-only-skill', 'user-only description', 'User-only.')
    await writeFile(join(root, 'user-only-skill/SKILL.md'), '---\nname: user-only-skill\ndescription: user-only description\ndisable-model-invocation: true\n---\n\nUser-only.\n')
    await writeSkill(root, 'model-only-skill', 'model-only description', 'Model-only.')
    await writeFile(join(root, 'model-only-skill/SKILL.md'), '---\nname: model-only-skill\ndescription: model-only description\nuser-invocable: false\n---\n\nModel-only.\n')

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home)
    /** 中文说明：变量 listedBeforeDelete 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listedBeforeDelete = await ctx.skills.list()
    /** 中文说明：函数值 flatSummary 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const flatSummary = listedBeforeDelete.find(skill => skill.name === 'flat-skill')
    if (flatSummary === undefined) throw new Error('expected flat-skill')
    await rm(join(root, 'flat-skill.md'))

    expect(listedBeforeDelete.map(skill => skill.name)).toEqual([
      'flat-skill',
      'model-only-skill',
      'no-trailing-body',
      'rich-skill',
      'user-only-skill',
    ])
    expect(flatSummary.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(await ctx.skills.get('flat-skill')).toBeUndefined()
    expect(await ctx.skills.get('no-trailing-body')).toMatchObject({
      invocation: { modelInvocable: true, userInvocable: true },
    })
    expect(await ctx.skills.get('user-only-skill')).toMatchObject({
      invocation: { modelInvocable: false, userInvocable: true },
      content: 'User-only.',
    })
    expect(await ctx.skills.get('model-only-skill')).toMatchObject({
      invocation: { modelInvocable: true, userInvocable: false },
      content: 'Model-only.',
    })
    expect(await ctx.skills.get('rich-skill')).toMatchObject({
      whenToUse: 'For richer local parsing',
      invocation: { modelInvocable: true, userInvocable: true },
      metadata: { owner: 'tests' },
    })
    expect(await ctx.skills.get('Bad_Name')).toBeUndefined()
  })

  it('accepts the documented boolean spellings for invocation frontmatter', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-invocation-booleans')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await mkdir(root, { recursive: true })
    /** 中文说明：变量 truthy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const truthy = ['true', 'TRUE', '"true"', 'yes', 'ON', '1', '"1"']
    /** 中文说明：变量 falsy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const falsy = ['false', 'FALSE', '"false"', 'no', 'OFF', '0', '"0"']
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [index, value] of truthy.entries()) {
      await writeFile(join(root, `truthy-${index}.md`), [
        '---',
        `name: truthy-${index}`,
        `description: Truthy ${index}`,
        `disable-model-invocation: ${value}`,
        '---',
        '',
        'Truthy.',
      ].join('\n'))
    }
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [index, value] of falsy.entries()) {
      await writeFile(join(root, `falsy-${index}.md`), [
        '---',
        `name: falsy-${index}`,
        `description: Falsy ${index}`,
        `user-invocable: ${value}`,
        '---',
        '',
        'Falsy.',
      ].join('\n'))
    }

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home)

    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [index] of truthy.entries()) {
      expect((await ctx.skills.get(`truthy-${index}`))?.invocation).toEqual({
        modelInvocable: false,
        userInvocable: true,
      })
    }
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [index] of falsy.entries()) {
      expect((await ctx.skills.get(`falsy-${index}`))?.invocation).toEqual({
        modelInvocable: true,
        userInvocable: false,
      })
    }
  })

  it('rejects legacy and invalid invocation frontmatter without hiding valid siblings', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-invalid-invocation')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'good-skill', 'Good skill')
    /** 中文说明：变量 invalid 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalid = [
      ['legacy-model', 'disableModelInvocation: true'],
      ['legacy-positive-model', 'modelInvocable: false'],
      ['legacy-user', 'userInvocable: false'],
      ['bad-string', 'disable-model-invocation: maybe'],
      ['bad-value', 'user-invocable: null'],
    ] as const
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const [name, field] of invalid) {
      await writeFile(join(root, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\n${field}\n---\n\nBad.\n`)
    }

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home)

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['good-skill'])
  })

  it('supports CRLF frontmatter and ignores delimiter-looking text inside YAML values', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-frontmatter-crlf')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'crlf-skill.md'), [
      '---',
      'name: crlf-skill',
      'description: CRLF skill',
      'metadata:',
      '  marker: "----"',
      '---',
      '',
      'CRLF body.',
    ].join('\r\n'))
    await writeFile(join(root, 'block-skill.md'), [
      '---',
      'name: block-skill',
      'description: |',
      '  Includes a ---- marker that is not a delimiter.',
      '---',
      '',
      'Block body.',
    ].join('\n'))

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home)

    expect((await ctx.skills.get('crlf-skill'))?.content).toBe('CRLF body.')
    expect((await ctx.skills.get('crlf-skill'))?.metadata).toEqual({ marker: '----' })
    expect((await ctx.skills.get('block-skill'))?.description).toBe('Includes a ---- marker that is not a delimiter.\n')
    expect((await ctx.skills.get('block-skill'))?.content).toBe('Block body.')
  })

  it('skips invalid YAML skill files without hiding valid siblings', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-invalid-yaml')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(root, 'good-skill', 'Good skill')
    await writeFile(join(root, 'bad-yaml.md'), '---\nname: bad-yaml\ndescription: [unclosed\n---\n\nBad body.\n')

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home)

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['good-skill'])
  })

  it('discovers symlinked skill directories and flat files', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-symlink-home')
    /** 中文说明：变量 external 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const external = await tempDir('skill-symlink-external')
    await writeSkill(external, 'linked-dir', 'Linked directory')
    await writeFlatSkill(external, 'linked-flat', 'Linked flat')
    await mkdir(join(home, '.dsh/skills'), { recursive: true })
    await symlink(join(external, 'linked-dir'), join(home, '.dsh/skills/linked-dir'))
    await symlink(join(external, 'linked-flat.md'), join(home, '.dsh/skills/linked-flat.md'))
    await symlink(join(external, 'missing'), join(home, '.dsh/skills/broken-link'))
    await symlink('/dev/null', join(home, '.dsh/skills/device-link'))

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home)

    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['linked-dir', 'linked-flat'])
  })

  it('uses the filesystem service for discovery, reads, and project-root lookup', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-read-fs')
    /** 中文说明：变量 project 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const project = await tempDir('skill-project-root-backend')
    /** 中文说明：变量 nestedCwd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nestedCwd = join(project, 'packages/app')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await mkdir(nestedCwd, { recursive: true })
    await writeFlatSkill(root, 'text-skill', 'Text skill', 'Text body.')
    await writeFlatSkill(root, 'resolve-fail', 'Resolve fail', 'Resolve body.')
    await writeFlatSkill(root, 'stat-fail', 'Stat fail', 'Stat body.')
    await mkdir(join(root, 'empty-dir'), { recursive: true })
    await mkdir(join(root, 'directory-skill/SKILL.md'), { recursive: true })
    await writeFile(join(root, 'binary-skill.md'), Buffer.concat([
      Buffer.from('---\nname: binary-skill\ndescription: Binary skill\n---\n\n'),
      Buffer.from([0xff]),
      Buffer.from('\n'),
    ]))
    await writeSkill(join(project, '.agents/skills'), 'backend-root', 'Backend root skill')

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(TestFileSystem)
    /** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fs = ctx.fs as TestFileSystem
    fs.failResolvePaths.add(join(root, 'resolve-fail.md'))
    fs.failStatPaths.add(join(root, 'stat-fail.md'))
    fs.failResolvePaths.add(join(nestedCwd, '.git'))
    fs.failStatPaths.add(join(project, 'packages/.git'))
    fs.statOverrides.set(join(project, '.git'), {
      version: FsVersion('virtual-git'),
      type: 'directory',
      size: 0,
    })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })

    expect((await ctx.skills.list({ cwd: nestedCwd })).map(skill => [skill.name, skill.source])).toEqual([
      ['backend-root', 'project-agents'],
      ['text-skill', 'user-dsh'],
    ])
    expect(fs.listDirCalls).toBeGreaterThan(0)
    expect(await ctx.skills.get('binary-skill')).toBeUndefined()

    /** 中文说明：变量 bundled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundled = await tempDir('skill-backend-bundled')
    await writeSkill(bundled, 'bundled-host', 'Bundled host skill')
    /** 中文说明：变量 bundledCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundledCtx = new Context()
    await bundledCtx.plugin(TestFileSystem)
    /** 中文说明：变量 bundledFs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bundledFs = bundledCtx.fs as TestFileSystem
    bundledFs.failResolvePaths.add(bundled)
    await bundledCtx.plugin(SkillRegistry)
    await bundledCtx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      bundledSkillDir: bundled,
    })
    expect((await bundledCtx.skills.get('bundled-host'))?.source).toBe('bundled')
  })

  it('reports transient root reads as incomplete without caching an empty catalog', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-transient-root')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.agents/skills')
    await writeSkill(root, 'stable-skill', 'Stable skill')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(TestFileSystem)
    /** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fs = ctx.fs as TestFileSystem
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'stable-skill' }],
      complete: true,
    })
    fs.failListDirPaths.add(root)
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(root, 'stable-skill/SKILL.md')
    ctx.emit(
      'fs/observed',
      { targetKey: path as never, displayPath: path },
      { kind: 'present', version: FsVersion('failed-read') },
      { name: 'edit' },
    )
    expect(await ctx.skills.snapshot()).toEqual({ skills: [], complete: false })

    fs.failListDirPaths.clear()
    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'stable-skill' }],
      complete: true,
    })
  })

  it('distinguishes transient filesystem entry failures from confirmed disappearance', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-transient-entry')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.agents/skills')
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(root, 'stable-skill/SKILL.md')
    await writeSkill(root, 'stable-skill', 'Stable skill')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(TestFileSystem)
    /** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fs = ctx.fs as TestFileSystem
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })
    /** 中文说明：函数值 invalidate 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const invalidate = (): void => {
      ctx.emit(
        'fs/observed',
        { targetKey: path as never, displayPath: path },
        { kind: 'present', version: FsVersion('entry-failure') },
        { name: 'write' },
      )
    }

    expect((await ctx.skills.snapshot()).complete).toBe(true)
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const failures of [fs.errorResolvePaths, fs.errorStatPaths, fs.errorReadPaths]) {
      failures.add(path)
      invalidate()
      expect((await ctx.skills.snapshot()).complete).toBe(false)
      failures.clear()
    }

    fs.missingReadPaths.add(path)
    invalidate()
    expect(await ctx.skills.snapshot()).toEqual({ skills: [], complete: true })
    fs.missingReadPaths.clear()
    invalidate()
    expect(await ctx.skills.snapshot()).toMatchObject({
      skills: [{ name: 'stable-skill' }],
      complete: true,
    })
  })

  it('marks an unexpected native skill-file read failure incomplete', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-native-read-failure')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.agents/skills')
    await mkdir(join(root, 'broken-skill/SKILL.md'), { recursive: true })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home)

    expect(await ctx.skills.snapshot()).toEqual({ skills: [], complete: false })
  })

  it('forwards cancellation to filesystem reads while loading a skill', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-read-abort')
    await writeSkill(join(home, '.dsh/skills'), 'abortable-skill', 'Abortable skill')

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(TestFileSystem)
    /** 中文说明：变量 fs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fs = ctx.fs as TestFileSystem
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['abortable-skill'])

    fs.statSignals = []
    fs.readTextSignals = []
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    fs.readTextOverride = async (_target, signal) => {
      if (signal === undefined) throw new Error('expected the skill lookup signal')
      started.resolve(undefined)
      return await new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          /** 中文说明：变量 abortReason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const abortReason = signal.reason as unknown
          reject(abortReason instanceof Error ? abortReason : new Error(String(abortReason)))
        }, { once: true })
      })
    }
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('turn cancelled')
    /** 中文说明：变量 loading 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loading = ctx.skills.get('abortable-skill', { signal: controller.signal })
    await started.promise
    controller.abort(reason)

    await expect(loading).rejects.toBe(reason)
    expect(fs.statSignals).toEqual([controller.signal])
    expect(fs.readTextSignals).toEqual([controller.signal])
  })

  it('refreshes additions, metadata changes, deletions, and a recreated missing root', { timeout: 20000 }, async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-home')
    /** 中文说明：变量 agentsRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agentsRoot = join(home, '.agents/skills')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchStabilityThresholdMs: 20,
      watchPollIntervalMs: 10,
    })
    try {
      expect(await ctx.skills.list()).toEqual([])

      await writeSkill(agentsRoot, 'watched-skill', 'First description', 'First body.')
      /** 中文说明：变量 added 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const added = await waitFor(
        async () => await ctx.skills.list(),
        skills => skills.some(skill => skill.name === 'watched-skill'),
      )
      expect(added.find(skill => skill.name === 'watched-skill')?.description).toBe('First description')

      await writeSkill(agentsRoot, 'watched-skill', 'Second description', 'Second body.')
      /** 中文说明：变量 changed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const changed = await waitFor(
        async () => await ctx.skills.list(),
        skills => skills.find(skill => skill.name === 'watched-skill')?.description === 'Second description',
      )
      expect(changed).toHaveLength(1)
      expect((await ctx.skills.get('watched-skill'))?.content).toBe('Second body.')

      await writeFlatSkill(agentsRoot, 'flat-added', 'Flat added')
      expect(await waitFor(
        async () => (await ctx.skills.list()).map(skill => skill.name),
        names => names.includes('flat-added'),
      )).toEqual(['flat-added', 'watched-skill'])

      await rename(join(agentsRoot, 'watched-skill'), join(agentsRoot, 'renamed-skill'))
      await writeSkill(agentsRoot, 'renamed-skill', 'Renamed skill')
      expect(await waitFor(
        async () => (await ctx.skills.list()).map(skill => skill.name),
        names => names.includes('renamed-skill') && !names.includes('watched-skill'),
      )).toEqual(['flat-added', 'renamed-skill'])

      await rm(join(agentsRoot, 'renamed-skill'), { recursive: true })
      expect(await waitFor(
        async () => (await ctx.skills.list()).map(skill => skill.name),
        names => !names.includes('renamed-skill'),
      )).toEqual(['flat-added'])

      await rm(join(home, '.agents'), { recursive: true })
      expect(await waitFor(
        async () => await ctx.skills.list(),
        skills => skills.length === 0,
      )).toEqual([])

      await writeSkill(agentsRoot, 'recreated-skill', 'Recreated')
      expect(await waitFor(
        async () => (await ctx.skills.list()).map(skill => skill.name),
        names => names.includes('recreated-skill'),
      )).toEqual(['recreated-skill'])
    } finally {
      await fiber.dispose()
    }

  })

  it('uses fs/observed as a synchronous first-party invalidation path without a watcher', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-observed-home')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.agents/skills')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setupLocal(home)
    expect(await ctx.skills.list()).toEqual([])
    /** 中文说明：变量 invalidations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let invalidations = 0
    ctx.on('skills/change', () => { invalidations += 1 })

    await writeSkill(root, 'observed-skill', 'Observed skill')
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(root, 'observed-skill/SKILL.md')
    /** 中文说明：函数值 emitObserved 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const emitObserved = (displayPath: string, actor?: object): void => {
      ctx.emit(
        'fs/observed',
        { targetKey: displayPath as never, displayPath },
        { kind: 'present', version: FsVersion('observed') },
        actor,
      )
    }
    emitObserved(path)
    emitObserved(path, {})
    emitObserved(path, { name: 'read' })
    emitObserved(join(home, 'outside.md'), { name: 'write' })
    emitObserved(root, { name: 'write' })
    emitObserved(join(root, 'observed-skill/references/notes.md'), { name: 'write' })
    emitObserved(join(home, '.dsh/skills/.system/SKILL.md'), { name: 'write' })
    emitObserved(join(root, 'flat-skill.md'), { name: 'write' })
    ctx.emit(
      'fs/observed',
      { targetKey: path as never, displayPath: path },
      { kind: 'present', version: FsVersion('observed') },
      { name: 'edit' },
    )

    expect(invalidations).toBe(2)
    expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['observed-skill'])
  })

  it('bounds project watchers and re-observes an evicted project on its next lookup', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-lru-home')
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await tempDir('skill-watch-lru-first')
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = await tempDir('skill-watch-lru-second')
    await mkdir(join(first, '.git'), { recursive: true })
    await mkdir(join(second, '.git'), { recursive: true })
    await writeSkill(join(first, '.agents/skills'), 'first-project', 'First project')
    await writeSkill(join(second, '.agents/skills'), 'second-project', 'Second project')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      customSkillDirs: [join(first, '.agents/skills')],
      watch: true,
      watchMaxProjects: 1,
      watchStabilityThresholdMs: 20,
      watchPollIntervalMs: 10,
    })
    try {
      expect((await ctx.skills.list({ cwd: first })).map(skill => skill.name)).toContain('first-project')
      expect((await ctx.skills.list({ cwd: second })).map(skill => skill.name)).toContain('second-project')
      await writeSkill(join(first, '.agents/skills'), 'first-project', 'First project refreshed')

      expect((await ctx.skills.list({ cwd: first })).find(skill => skill.name === 'first-project')?.description)
        .toBe('First project refreshed')
    } finally {
      await fiber.dispose()
    }

    /** 中文说明：变量 noWatch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const noWatch = new Context()
    await noWatch.plugin(SkillRegistry)
    await noWatch.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
      watchMaxProjects: 1,
    })
    await noWatch.skills.list({ cwd: first })
    await noWatch.skills.list({ cwd: second })
  })

  it('contains repeated disposal and late first-party observations', async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-dispose')
    /** 中文说明：变量 nonDirectoryRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nonDirectoryRoot = join(home, 'not-a-directory')
    await writeFile(nonDirectoryRoot, 'not a skill root')
    await writeSkill(join(home, '.agents/skills'), 'disposed-skill', 'Disposed skill')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let provider!: SkillFileSystem.FileSystemSkillProvider
    /** 中文说明：函数值 disposeProvider 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposeProvider = ctx.skills.registerProvider((control) => {
      provider = new SkillFileSystem.FileSystemSkillProvider(ctx, control, {
        dshHome: join(home, '.dsh'),
        agentsHome: join(home, '.agents'),
        customSkillDirs: [nonDirectoryRoot],
        watch: true,
        watchStabilityThresholdMs: 20,
        watchPollIntervalMs: 10,
      })
      return provider
    })
    /** 中文说明：变量 beforeDisposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const beforeDisposal = await provider.list({})
    expect((Array.isArray(beforeDisposal) ? beforeDisposal : beforeDisposal.candidates).map(skill => skill.name))
      .toEqual(['disposed-skill'])

    await provider.dispose()
    await provider.dispose()
    provider.observeHostMutation(join(home, '.agents/skills/disposed-skill/SKILL.md'))

    /** 中文说明：变量 afterDisposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const afterDisposal = await provider.list({})
    expect((Array.isArray(afterDisposal) ? afterDisposal : afterDisposal.candidates).map(skill => skill.name))
      .toEqual(['disposed-skill'])
    disposeProvider()
  })

  it('refreshes frontmatter through a followed skill symlink', { timeout: 10000 }, async () => {
    /** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const home = await tempDir('skill-watch-symlink-home')
    /** 中文说明：变量 external 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const external = await tempDir('skill-watch-symlink-external')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(home, '.dsh/skills')
    await writeSkill(external, 'linked-skill', 'First linked description')
    await mkdir(root, { recursive: true })
    await symlink(join(external, 'linked-skill'), join(root, 'linked-skill'))
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: true,
      watchFollowSymlinks: true,
      watchStabilityThresholdMs: 20,
      watchPollIntervalMs: 10,
    })
    try {
      expect((await ctx.skills.list())[0]?.description).toBe('First linked description')
      await writeSkill(external, 'linked-skill', 'Second linked description')
      /** 中文说明：变量 refreshed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const refreshed = await waitFor(
        async () => await ctx.skills.list(),
        skills => skills[0]?.description === 'Second linked description',
      )
      expect(refreshed[0]?.name).toBe('linked-skill')
    } finally {
      await fiber.dispose()
    }
  })

  it('validates watcher tunables at plugin load', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)

    await expect(ctx.plugin(SkillFileSystem, { watchMaxProjects: 0 })).rejects.toThrow('watchMaxProjects')
    await expect(ctx.plugin(SkillFileSystem, { watchPollIntervalMs: 1.5 })).rejects.toThrow('watchPollIntervalMs')
    await expect(ctx.plugin(SkillFileSystem, { watchStabilityThresholdMs: 0 })).rejects.toThrow('watchStabilityThresholdMs')
  })

  it('uses default home root resolution without exposing builtin skills', async () => {
    /** 中文说明：变量 previousDshHome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const previousDshHome = process.env.DSH_HOME
    /** 中文说明：变量 previousAgentsHome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const previousAgentsHome = process.env.DSH_AGENTS_HOME
    /** 中文说明：变量 previousBundledSkillDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const previousBundledSkillDir = process.env.DSH_BUNDLED_SKILL_DIR
    /** 中文说明：变量 envHome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const envHome = await tempDir('skill-env-home')
    try {
      process.env.DSH_HOME = join(envHome, '.dsh')
      process.env.DSH_AGENTS_HOME = join(envHome, '.agents')
      /** 中文说明：变量 bundled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const bundled = join(envHome, 'bundled-skills')
      process.env.DSH_BUNDLED_SKILL_DIR = bundled
      await writeSkill(join(envHome, '.dsh/skills'), 'env-skill', 'Env skill')
      await writeSkill(bundled, 'env-bundled-skill', 'Env bundled skill')
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(SkillFileSystem, { watch: false })
      expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['env-bundled-skill', 'env-skill'])

      // Isolated providers see only their explicit roots: the environment
      // bundled root is a default root, so includeDefaultRoots: false must
      // drop it — isolated providers never re-claim the app's builtins.
      /** 中文说明：变量 isolated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const isolated = new Context()
      await isolated.plugin(SkillRegistry)
      /** 中文说明：变量 customOnly 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const customOnly = join(envHome, 'custom-only')
      await writeSkill(customOnly, 'custom-isolated-skill', 'Custom isolated skill')
      await isolated.plugin(SkillFileSystem, {
        providerName: 'isolated',
        includeDefaultRoots: false,
        customSkillDirs: [customOnly],
        watch: false,
      })
      expect((await isolated.skills.list()).map(skill => skill.name)).toEqual(['custom-isolated-skill'])
      await isolated.fiber.dispose()

      process.env.DSH_HOME = join(envHome, 'empty-dsh')
      delete process.env.DSH_BUNDLED_SKILL_DIR
      process.env.DSH_AGENTS_HOME = join(envHome, 'empty-agents')
      /** 中文说明：变量 empty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const empty = new Context()
      await empty.plugin(SkillRegistry)
      SkillFileSystem.apply(empty, { watch: false })
      expect(await empty.skills.list()).toEqual([])

      delete process.env.DSH_AGENTS_HOME
      expect(new SkillFileSystem.FileSystemSkillProvider(empty, {
        signal: new AbortController().signal,
        invalidate() {},
      }, { dshHome: join(envHome, 'empty-dsh') }).name).toBe('filesystem')
    } finally {
      if (previousDshHome === undefined) {
        delete process.env.DSH_HOME
      } else {
        process.env.DSH_HOME = previousDshHome
      }
      if (previousAgentsHome === undefined) {
        delete process.env.DSH_AGENTS_HOME
      } else {
        process.env.DSH_AGENTS_HOME = previousAgentsHome
      }
      if (previousBundledSkillDir === undefined) {
        delete process.env.DSH_BUNDLED_SKILL_DIR
      } else {
        process.env.DSH_BUNDLED_SKILL_DIR = previousBundledSkillDir
      }
    }
  })
})
