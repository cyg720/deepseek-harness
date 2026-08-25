/**
 * Typecheck Markdown `ts` fences against the workspace API. `ignore-check` fences are reported as
 * opt-outs; generated catalog fragments and source-equivalence blocks are skipped here because their
 * owning gates verify them. Byte-identical `.zh.md` copies reuse their unsuffixed sibling's check. A
 * build-coordinated mode consumes existing declarations without emit.
 */
/*
 * 文件职责：实现 doc-typecheck.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { execFileSync } from 'node:child_process'
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { builtDeclarationPath } from './doc-typecheck-paths.ts'
import { markdownFences } from './markdown.ts'
import { partitionPairedMarkdownDerivatives } from './paired-markdown-derivatives.ts'
import { isArchivedAgentNotePath } from './repo-files.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')

/**
 * TypeScript-fence ownership. `check` compiles; `ignore` is an unchecked sketch
 * counted in the opt-out ratio; the catalog and type-equivalence variants are
 * excluded from that ratio because their owning gates verify them.
 */
/* 中文说明：type BlockKind 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
type BlockKind = 'check' | 'ignore' | 'type-equiv' | 'cordis-catalog' | 'persistence-catalog' | 'config-catalog'

/** One extracted code block. */
/* 中文说明：interface Block 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface Block {
  file: string
  /** 1-based line of the opening fence. */
  line: number
  kind: BlockKind
  code: string
}

/** The info-string → kind table this gate tracks. */
/* 中文说明：常量 KIND_BY_INFO 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const KIND_BY_INFO: Record<string, BlockKind> = {
  'ts': 'check',
  'ts ignore-check': 'ignore',
  'ts type-equiv': 'type-equiv',
  'ts public-api': 'type-equiv',
  'ts cordis-catalog': 'cordis-catalog',
  'ts persistence-catalog': 'persistence-catalog',
  'ts config-catalog': 'config-catalog',
}

/** Extract every recognized TypeScript fence from one Markdown file. */
/* 中文说明：函数 extractBlocks 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function extractBlocks(absPath: string): Block[] {
  /** 中文说明：变量 file 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const file = relative(root, absPath)
  return markdownFences(readFileSync(absPath, 'utf8')).flatMap((fence) => {
    /** 中文说明：变量 kind 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const kind = KIND_BY_INFO[fence.info]
    return kind === undefined ? [] : [{ file, line: fence.line, kind, code: fence.code }]
  })
}

/** 中文说明：变量 configHost 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const configHost: ts.ParseConfigFileHost = {
  ...ts.sys,
  getCurrentDirectory: () => root,
  onUnRecoverableConfigFileDiagnostic(diagnostic) {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  },
}

/**
 * Load host-aggregate settings and redirect workspace aliases to declarations
 * from the coordinated build. Doc fragments speak the host vocabulary; the host
 * aggregate (never the root solution — it has no compilerOptions) carries the
 * workspace paths via tsconfig.base.json.
 */
/* 中文说明：函数 builtTypeCompilerOptions 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function builtTypeCompilerOptions(): ts.CompilerOptions {
  /** 中文说明：变量 configPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configPath = join(root, 'tsconfig.host.json')
  /** 中文说明：变量 parsed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, configHost)
  if (!parsed) throw new Error(`doc-typecheck: cannot parse ${configPath}`)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  if (parsed.options.paths === undefined) throw new Error('doc-typecheck: host tsconfig has no workspace paths')
  /** 中文说明：函数值 paths 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const paths = Object.fromEntries(Object.entries(parsed.options.paths).map(([specifier, candidates]) => [
    specifier,
    candidates.map(builtDeclarationPath),
  ]))
  /** 中文说明：变量 options 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const options: ts.CompilerOptions = {
    ...parsed.options,
    paths,
    noEmit: true,
    composite: false,
    incremental: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
  }
  delete options.tsBuildInfoFile
  return options
}

/** Compile Markdown blocks as virtual files against declarations from the coordinated build. */
/* 中文说明：函数 compileBlocksAgainstBuiltTypes 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function compileBlocksAgainstBuiltTypes(blocks: Block[]): readonly ts.Diagnostic[] {
  /** 中文说明：变量 options 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const options = builtTypeCompilerOptions()
  /** 中文说明：变量 sources 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const sources = new Map<string, string>()
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const [index, block] of blocks.entries()) {
    /** 中文说明：变量 fileName 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fileName = resolve(root, '.doc-typecheck', `block-${index}.ts`)
    sources.set(fileName, block.code.endsWith('\n') ? block.code : `${block.code}\n`)
  }

  /** 中文说明：变量 baseHost 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const baseHost = ts.createCompilerHost(options, true)
  /** 中文说明：变量 host 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists(fileName) {
      return sources.has(resolve(fileName)) || baseHost.fileExists(fileName)
    },
    readFile(fileName) {
      return sources.get(resolve(fileName)) ?? baseHost.readFile(fileName)
    },
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const source = sources.get(resolve(fileName))
      if (source !== undefined) return ts.createSourceFile(fileName, source, languageVersion, true)
      return baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
    },
    writeFile() {
      throw new Error('doc-typecheck: noEmit compilation attempted to write output')
    },
  }
  /** 中文说明：变量 program 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const program = ts.createProgram([...sources.keys()], options, host)
  return ts.getPreEmitDiagnostics(program)
}

/** Render compiler diagnostics with virtual block paths mapped back to Markdown. */
/* 中文说明：函数 formatDiagnostics 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function formatDiagnostics(diagnostics: readonly ts.Diagnostic[], blocks: Block[]): string {
  /** 中文说明：变量 formatted 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const formatted = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => ts.sys.newLine,
  })
  return remapBlockPaths(formatted, blocks)
}

/**
 * Reuse the Host aggregate references from a temp project one directory below
 * root. Generated Client API examples opt out because their declarations do
 * not exist until Host tsdown has run.
 */
/* 中文说明：函数 workspaceReferences 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function workspaceReferences(): { path: string }[] {
  /** 中文说明：变量 file 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const file = join(root, 'tsconfig.host.json')
  // Parse with TypeScript's own JSONC reader: a regex comment stripper corrupts the `/*/` path
  // candidate in the workspace wildcard.
  /** 中文说明：函数值 result 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
  const result = ts.readConfigFile(file, path => readFileSync(path, 'utf8'))
  if (result.error) {
    throw new Error(`doc-typecheck: cannot read ${file}: ${ts.flattenDiagnosticMessageText(result.error.messageText, '\n')}`)
  }
  // `config` is typed `any` by the TS API; narrow it to the one field read here.
  const { references } = result.config as { references: { path: string }[] }
  return references.map(({ path }) => ({
    path: path.startsWith('./') ? `../${path.slice(2)}` : `../${path}`,
  }))
}

/** The standalone temp project used when no coordinated build owns declaration freshness. */
/* 中文说明：函数 tempTsconfig 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function tempTsconfig(): string {
  return JSON.stringify({
    extends: '../tsconfig.host.json',
    compilerOptions: {
      noUnusedLocals: false,
      noUnusedParameters: false,
      tsBuildInfoFile: './tsconfig.tsbuildinfo',
    },
    include: ['block-*.ts'],
    references: workspaceReferences(),
  })
}

/** Compile blocks through project references for the standalone command. */
/* 中文说明：函数 compileBlocksStandalone 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function compileBlocksStandalone(blocks: Block[]): string | undefined {
  /** 中文说明：变量 tmp 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tmp = mkdtempSync(join(root, '.doc-typecheck-'))
  try {
    writeFileSync(join(tmp, 'tsconfig.json'), tempTsconfig())
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const [index, block] of blocks.entries()) {
      writeFileSync(join(tmp, `block-${index}.ts`), block.code.endsWith('\n') ? block.code : `${block.code}\n`)
    }
    try {
      // Invoke tsc's JS entry through Node instead of a platform-specific shell shim.
      execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b', join(tmp, 'tsconfig.json')], {
        cwd: root,
        stdio: 'pipe',
      })
      return undefined
    } catch (error: unknown) {
      /** 中文说明：变量 failed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const failed = error as { stdout?: Buffer; stderr?: Buffer }
      return remapBlockPaths(`${failed.stdout?.toString() ?? ''}${failed.stderr?.toString() ?? ''}`, blocks)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Map virtual or temporary block paths back to their owning Markdown fences. */
/* 中文说明：函数 remapBlockPaths 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function remapBlockPaths(output: string, blocks: Block[]): string {
  return output.replace(/(?:[^\s:()]*[/\\])?block-(\d+)\.ts\((\d+),(\d+)\)/g, (_match, index: string, line: string, column: string) => {
    /** 中文说明：变量 block 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const block = blocks[Number(index)]
    if (!block) return `block-${index}.ts(${line},${column})`
    return `${block.file} (block at line ${block.line}, +${line}:${column})`
  })
}

/** 中文说明：变量 markdownGlobs 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const markdownGlobs = ['README.md', '.agents/notes/**/*.md', 'docs/**/*.md', 'packages/*/*.md', 'packages/*/*/*.md']

/** 中文说明：变量 files 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const files: string[] = []
/** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
for (const pattern of markdownGlobs) {
  /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
  for (const match of globSync(pattern, { cwd: root })) {
    if (!isArchivedAgentNotePath(match)) files.push(resolve(root, match))
  }
}
files.sort()

/** 中文说明：变量 extracted 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const extracted = files.flatMap(extractBlocks)
const { primary: all, derivatives } = partitionPairedMarkdownDerivatives(
  extracted,
  block => block.file,
  block => `${block.kind}\0${block.code}`,
)
/** 中文说明：函数值 checked 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const checked = all.filter(b => b.kind === 'check')
/** 中文说明：函数值 ignored 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
const ignored = all.filter(b => b.kind === 'ignore')
// Only compile-eligible fences belong in the opt-out ratio; every other skipped
// kind has an independent verifier named in the BlockKind rules above.
/** 中文说明：变量 ratioDenominator 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const ratioDenominator = checked.length + ignored.length

if (checked.length === 0) {
  console.log('doc-typecheck: no ts code blocks to check.')
  process.exit(0)
}

/** 中文说明：变量 useBuiltTypes 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const useBuiltTypes = process.env.DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT === '1'
/** 中文说明：变量 compilationError 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const compilationError = useBuiltTypes
  ? (() => {
    /** 中文说明：变量 diagnostics 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const diagnostics = compileBlocksAgainstBuiltTypes(checked)
    return diagnostics.length === 0 ? undefined : formatDiagnostics(diagnostics, checked)
  })()
  : compileBlocksStandalone(checked)
if (compilationError !== undefined) {
  console.error('doc-typecheck: documentation code blocks failed to compile.\n')
  console.error(compilationError)
  process.exit(1)
}

/** 中文说明：变量 ratio 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const ratio = ignored.length / ratioDenominator
/** 中文说明：变量 skipped 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const skipped = all.length - ratioDenominator
console.log(`doc-typecheck: ${checked.length} block(s) compiled, ${ignored.length} ignored (${(ratio * 100).toFixed(0)}% opt-out), ${skipped} type-equiv/catalog (checked elsewhere), ${derivatives.length} paired derivative(s).`)
// Guard against the escape hatch becoming the norm.
if (ratioDenominator >= 4 && ratio > 0.5) {
  console.error(`doc-typecheck: too many blocks opt out of checking (${ignored.length}/${ratioDenominator}). Make them compile or delete them.`)
  process.exit(1)
}
