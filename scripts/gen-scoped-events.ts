/**
 * Generate dsh-scope's invariant resolver map from the repository TypeScript
 * Program.
 *
 * A scoped event declares `this: Scoped<Base>`. Real `scopeTarget(base, key)`
 * calls establish the routing-key type for that base. The generator searches
 * every event payload parameter and one property level for exactly one type
 * equivalent to that key. Each generated resolver compiles against the merged
 * `Events` parameter tuple. Zero matches require `@dshScopeScan unsupported`;
 * multiple matches are ambiguous and always fail loud.
 *
 *   `tsx scripts/gen-scoped-events.ts`          -> write the generated source
 *   `tsx scripts/gen-scoped-events.ts --check`  -> exit 1 when it is stale
 */
/*
 * 文件职责：实现 gen-scoped-events.ts 覆盖的仓库生成、校验或维护职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统、AST 或项目图分析。
 * 产品维度：保障源码、生成目录、文档和发布元数据在开发与 CI 中保持一致。
 * 逻辑维度：读取仓库输入，构建中间模型，执行生成或校验，再报告差异和失败。
 * 关键边界：生成结果必须确定；路径与源码文本不可信；校验失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和输入目录，再读模型转换，最后关注输出文件与失败条件。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { pointer, rawJsDoc } from './jsdoc.ts'
import { TypeScriptProject } from './ts-project.ts'

/** 中文说明：变量 root 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：常量 OUT 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OUT = 'packages/core/scope/src/scoped-events.generated.ts'
/** 中文说明：常量 SCOPE_DOC_MARKER 保存本脚本共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SCOPE_DOC_MARKER = 'Scope-filtered dispatch'

/** 中文说明：interface ScopeTargetContract 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface ScopeTargetContract {
  baseType: ts.Type
  keyType: ts.Type
  source: string
}

/** 中文说明：interface SubjectCandidate 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface SubjectCandidate {
  path: string
  parameter: number
  property?: string
  type: ts.Type
}

/** 中文说明：interface ScopedEventResolver 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface ScopedEventResolver {
  event: string
  candidate: SubjectCandidate | null
}

/** 中文说明：interface ScopeTag 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
interface ScopeTag {
  present: boolean
  unsupported: boolean
}

/** Program-backed analyzer and renderer for the generated scoped-event resolvers. */
/* 中文说明：class ScopedEventGenerator 定义本脚本所需的数据或行为，用于表达仓库脚本场景。 */
class ScopedEventGenerator {
  private readonly checker: ts.TypeChecker
  private readonly packageSources: ts.SourceFile[]
  private readonly scopeTargetDeclaration: ts.FunctionDeclaration
  private readonly scopedSymbol: ts.Symbol
  private readonly violations: string[] = []

  constructor(private readonly project: TypeScriptProject) {
    this.checker = project.checker
    this.packageSources = project.sourceFiles().filter((sourceFile) => {
      return /^packages\/[^/]+\/[^/]+\/src\/.+\.ts$/.test(project.relativePath(sourceFile))
    })
    this.scopeTargetDeclaration = this.functionDeclaration(
      'packages/core/scope/src/index.ts',
      'scopeTarget',
    )
    this.scopedSymbol = this.typeAliasSymbol(
      'packages/core/scope/src/index.ts',
      'Scoped',
    )
  }

  /** Render the complete generated TypeScript module or throw every contract violation. */
  render(): string {
    /** 中文说明：变量 contracts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const contracts = this.collectScopeTargetContracts()
    /** 中文说明：变量 resolvers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolvers = this.collectScopedEventResolvers(contracts)
    if (this.violations.length > 0) {
      throw new Error(
        `gen-scoped-events: ${this.violations.length} scoped-event contract violation(s):\n`
        + this.violations.map(violation => `  - ${violation}`).join('\n'),
      )
    }
    return [
      '/**',
      ' * Generated scoped-event routing-subject resolvers for dsh-scope invariants.',
      ' * Do not edit by hand; run `pnpm run gen-scoped-events`.',
      ' *',
      ' * @module @deepseek-ai/dsh-scope/scoped-events.generated',
      ' */',
      '',
      '/* 【文件职责】根据作用域事件声明生成路由主体解析器；无法提取主体的事件只验证作用域载体。 */',
      '',
      'type ScopedSubjectResolver = (args: readonly unknown[]) => unknown',
      '',
      'const scopedSubjectResolvers: Readonly<Record<string, ScopedSubjectResolver | null>> = Object.freeze({',
      ...resolvers.map(({ event, candidate }) => {
        if (candidate === null) return `  '${event}': null,`
        /** 中文说明：变量 subject 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const subject = candidate.property === undefined
          ? `args[${candidate.parameter}]`
          : `(args[${candidate.parameter}] as Record<string, unknown>)[${quote(candidate.property)}]`
        return `  '${event}': args => ${subject},`
      }),
      '})',
      '',
      '/**',
      ' * Resolve the routing key named by one scoped event payload. A null',
      ' * resolver means the payload cannot expose its external routing key, so the',
      ' * invariant checks carrier presence only.',
      ' * @param event - runtime Cordis event name.',
      ' * @returns the generated subject resolver, null for presence-only,',
      ' *   or undefined when the event is not scope-filtered.',
      ' */',
      'export function scopedSubjectResolverFor(event: string): ScopedSubjectResolver | null | undefined {',
      '  return scopedSubjectResolvers[event]',
      '}',
      '',
    ].join('\n')
  }

  /** Resolve one named function declaration from a known source file. */
  private functionDeclaration(relativePath: string, name: string): ts.FunctionDeclaration {
    /** 中文说明：变量 sourceFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sourceFile = this.project.sourceFile(relativePath)
    /** 中文说明：函数值 declaration 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => {
      return ts.isFunctionDeclaration(statement) && statement.name?.text === name
    })
    if (!declaration) throw new Error(`gen-scoped-events: cannot resolve function ${name} from ${relativePath}`)
    return declaration
  }

  /** Resolve one named type-alias symbol from a known source file. */
  private typeAliasSymbol(relativePath: string, name: string): ts.Symbol {
    /** 中文说明：变量 sourceFile 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sourceFile = this.project.sourceFile(relativePath)
    /** 中文说明：函数值 declaration 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const declaration = sourceFile.statements.find((statement): statement is ts.TypeAliasDeclaration => {
      return ts.isTypeAliasDeclaration(statement) && statement.name.text === name
    })
    /** 中文说明：变量 symbol 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const symbol = declaration && this.checker.getSymbolAtLocation(declaration.name)
    if (!symbol) throw new Error(`gen-scoped-events: cannot resolve type ${name} from ${relativePath}`)
    return symbol
  }

  /** Collect every real scopeTarget(base, key) base/key type contract. */
  private collectScopeTargetContracts(): ScopeTargetContract[] {
    /** 中文说明：变量 contracts 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const contracts: ScopeTargetContract[] = []
    /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const visit = (sourceFile: ts.SourceFile, node: ts.Node): void => {
      if (ts.isCallExpression(node)
        && this.checker.getResolvedSignature(node)?.declaration === this.scopeTargetDeclaration) {
        /** 中文说明：变量 base 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const base = node.arguments[0]
        /** 中文说明：变量 key 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const key = node.arguments[1]
        if (!base || !key) {
          /** 中文说明：变量 source 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const source = pointer(this.project.relativePath(sourceFile), sourceFile, node)
          this.violations.push(`${source} calls scopeTarget without base and key arguments`)
        } else {
          contracts.push({
            baseType: this.checker.getTypeAtLocation(base),
            keyType: this.checker.getTypeAtLocation(key),
            source: pointer(this.project.relativePath(sourceFile), sourceFile, node),
          })
        }
      }
      ts.forEachChild(node, (child) => { visit(sourceFile, child) })
    }
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const sourceFile of this.packageSources) visit(sourceFile, sourceFile)
    return contracts
  }

  /** Collect every Events member and derive its generated resolver. */
  private collectScopedEventResolvers(contracts: readonly ScopeTargetContract[]): ScopedEventResolver[] {
    /** 中文说明：变量 resolvers 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolvers: ScopedEventResolver[] = []
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const sourceFile of this.packageSources) {
      /** 中文说明：变量 rel 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const rel = this.project.relativePath(sourceFile)
      /** 中文说明：函数值 visit 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
      const visit = (node: ts.Node): void => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === 'Events' && isCordisModuleInterface(node)) {
          /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
          for (const member of node.members) {
            if (!ts.isMethodSignature(member) || !ts.isStringLiteral(member.name)) continue
            /** 中文说明：变量 event 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const event = member.name.text
            /** 中文说明：变量 raw 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const raw = rawJsDoc(sourceFile.text, member)
            /** 中文说明：变量 where 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const where = `event '${event}' (${pointer(rel, sourceFile, member)})`
            /** 中文说明：变量 tag 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const tag = parseScopeTag(raw, where, this.violations)
            /** 中文说明：变量 thisParameter 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const thisParameter = member.parameters.find(isThisParameter)
            /** 中文说明：变量 scopedBase 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const scopedBase = thisParameter && this.scopedBaseType(thisParameter)
            if (!scopedBase) {
              if (raw.includes(SCOPE_DOC_MARKER)) {
                this.violations.push(
                  `${where} documents scope-filtered dispatch but its signature has no this: Scoped<...> receiver`,
                )
              }
              if (tag.present) {
                this.violations.push(`${where} has @dshScopeScan metadata but is not a Scoped event`)
              }
              continue
            }
            if (!raw.includes(SCOPE_DOC_MARKER)) {
              this.violations.push(
                `${where} has this: Scoped<...> but its JSDoc does not explain "${SCOPE_DOC_MARKER}"`,
              )
            }
            /** 中文说明：变量 keyType 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const keyType = this.routingKeyType(where, scopedBase, contracts)
            if (!keyType) continue
            /** 中文说明：变量 candidates 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
            const candidates = this.subjectCandidates(member)
              .filter(candidate => this.typesEquivalent(candidate.type, keyType))
            if (candidates.length > 1) {
              this.violations.push(
                `${where} has multiple routing-key candidates for ${this.typeText(keyType)}: `
                + candidates.map(candidate => `${candidate.path}: ${this.typeText(candidate.type)}`).join(', '),
              )
              continue
            }
            if (candidates.length === 0) {
              if (!tag.unsupported) {
                /** 中文说明：变量 keyLabel 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
                const keyLabel = this.typeText(keyType)
                this.violations.push(
                  `${where} exposes no parameter or one-level property equivalent to routing key type ${keyLabel}; `
                  + 'add @dshScopeScan unsupported only when the key is intentionally absent from the payload',
                )
              }
              resolvers.push({ event, candidate: null })
              continue
            }
            if (tag.unsupported) {
              this.violations.push(
                `${where} has unnecessary @dshScopeScan unsupported; ${candidates[0]?.path} exposes the routing key`,
              )
              continue
            }
            resolvers.push({ event, candidate: candidates[0] ?? null })
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
    }
    return resolvers.sort((left, right) => left.event.localeCompare(right.event))
  }

  /** Extract the Base type from one exact this: Scoped<Base> parameter. */
  private scopedBaseType(parameter: ts.ParameterDeclaration): ts.Type | undefined {
    /** 中文说明：变量 type 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const type = this.checker.getTypeAtLocation(parameter)
    if (type.aliasSymbol !== this.scopedSymbol) return undefined
    return type.aliasTypeArguments?.[0]
  }

  /** Resolve one unambiguous key type for a scoped carrier base. */
  private routingKeyType(
    where: string,
    scopedBase: ts.Type,
    contracts: readonly ScopeTargetContract[],
  ): ts.Type | undefined {
    /** 中文说明：函数值 matches 封装本脚本的局部步骤；参数和返回值由右侧签名约束；示例见本脚本调用。 */
    const matches = contracts.filter((contract) => {
      return this.checker.isTypeAssignableTo(this.normalizedType(contract.baseType), this.normalizedType(scopedBase))
    })
    if (matches.length === 0) {
      this.violations.push(
        `${where} has no matching scopeTarget(base, key) call for carrier base ${this.typeText(scopedBase)}`,
      )
      return undefined
    }
    /** 中文说明：变量 keyTypes 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const keyTypes: ts.Type[] = []
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const match of matches) {
      if (!keyTypes.some(type => this.typesEquivalent(type, match.keyType))) keyTypes.push(match.keyType)
    }
    if (keyTypes.length > 1) {
      this.violations.push(
        `${where} carrier base ${this.typeText(scopedBase)} has inconsistent routing-key types: `
        + matches.map(match => `${this.typeText(match.keyType)} at ${match.source}`).join(', '),
      )
      return undefined
    }
    return keyTypes[0]
  }

  /** Enumerate every payload parameter and every accessible one-level property. */
  private subjectCandidates(member: ts.MethodSignature): SubjectCandidate[] {
    /** 中文说明：变量 candidates 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const candidates: SubjectCandidate[] = []
    /** 中文说明：变量 runtimeIndex 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let runtimeIndex = 0
    /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
    for (const parameter of member.parameters) {
      if (isThisParameter(parameter)) continue
      /** 中文说明：变量 directPath 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const directPath = `args[${runtimeIndex}]`
      /** 中文说明：变量 parameterType 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const parameterType = this.checker.getTypeAtLocation(parameter)
      candidates.push({ path: directPath, parameter: runtimeIndex, type: parameterType })
      /** 中文说明：该循环依次处理仓库文件或模型；循环变量仅在当前循环中有效。 */
      for (const property of this.checker.getPropertiesOfType(this.normalizedType(parameterType))) {
        /** 中文说明：变量 name 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const name = property.getName()
        if (name.startsWith('__@') || hasNonPublicDeclaration(property)) continue
        candidates.push({
          path: `${directPath}.${name}`,
          parameter: runtimeIndex,
          property: name,
          type: this.checker.getTypeOfSymbolAtLocation(property, parameter),
        })
      }
      runtimeIndex += 1
    }
    return dedupeCandidates(candidates)
  }

  /** Compare exact Program type identities after removing null and undefined. */
  private typesEquivalent(left: ts.Type, right: ts.Type): boolean {
    /** 中文说明：变量 normalizedLeft 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const normalizedLeft = this.normalizedType(left)
    /** 中文说明：变量 normalizedRight 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const normalizedRight = this.normalizedType(right)
    if (normalizedLeft.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false
    if (normalizedRight.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false
    return normalizedLeft === normalizedRight
  }

  /** Remove null and undefined from a routing or candidate type. */
  private normalizedType(type: ts.Type): ts.Type {
    return this.checker.getNonNullableType(type)
  }

  /** Render a stable diagnostic type label. */
  private typeText(type: ts.Type): string {
    return this.checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
  }
}

/** Return whether an Events interface is inside declare module '@deepseek-ai/cordis'. */
/* 中文说明：函数 isCordisModuleInterface 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isCordisModuleInterface(node: ts.InterfaceDeclaration): boolean {
  /** 中文说明：变量 block 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const block = node.parent
  /** 中文说明：变量 declaration 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const declaration = block.parent
  return ts.isModuleBlock(block)
    && ts.isModuleDeclaration(declaration)
    && ts.isStringLiteral(declaration.name)
    && declaration.name.text === '@deepseek-ai/cordis'
}

/** Return whether a parameter is the explicit TypeScript this receiver. */
/* 中文说明：函数 isThisParameter 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function isThisParameter(parameter: ts.ParameterDeclaration): boolean {
  return ts.isIdentifier(parameter.name) && parameter.name.text === 'this'
}

/** Parse and validate the optional @dshScopeScan unsupported tag. */
/* 中文说明：函数 parseScopeTag 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function parseScopeTag(raw: string, where: string, violations: string[]): ScopeTag {
  /** 中文说明：变量 tags 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tags = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').trim())
    .filter(line => line.startsWith('@dshScopeScan'))
  if (tags.length > 1) violations.push(`${where} has multiple @dshScopeScan tags`)
  if (tags.length === 0) return { present: false, unsupported: false }
  /** 中文说明：变量 unsupported 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const unsupported = tags[0] === '@dshScopeScan unsupported'
  if (!unsupported) {
    violations.push(
      `${where} has invalid scoped-event scan metadata '${tags[0]}'; expected '@dshScopeScan unsupported'`,
    )
  }
  return { present: true, unsupported }
}

/** Return whether a property has a private or protected declaration. */
/* 中文说明：函数 hasNonPublicDeclaration 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function hasNonPublicDeclaration(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) => {
    if (!ts.canHaveModifiers(declaration)) return false
    return ts.getModifiers(declaration)?.some((modifier) => {
      return modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword
    }) ?? false
  })
}

/** Deduplicate candidate paths contributed by merged/intersection types. */
/* 中文说明：函数 dedupeCandidates 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function dedupeCandidates(candidates: readonly SubjectCandidate[]): SubjectCandidate[] {
  /** 中文说明：变量 seen 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false
    seen.add(candidate.path)
    return true
  })
}

/** Quote a generated property key as a single-quoted TypeScript string. */
/* 中文说明：函数 quote 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

/**
 * Render the generated scoped-event resolver module for one repository root.
 * @param projectRoot - repository root carrying tsconfig.host.json.
 * @returns complete generated TypeScript source.
 */
/* 中文说明：函数 renderScopedEvents 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
export function renderScopedEvents(projectRoot: string = root): string {
  return new ScopedEventGenerator(new TypeScriptProject(projectRoot)).render()
}

/** Generate or freshness-check the fixed dsh-scope source file. */
/* 中文说明：函数 main 承担本脚本的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本脚本调用。 */
function main(): void {
  /** 中文说明：变量 content 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const content = renderScopedEvents()
  /** 中文说明：变量 output 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const output = resolve(root, OUT)
  if (process.argv.includes('--check')) {
    /** 中文说明：变量 committed 保存本脚本当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const committed = existsSync(output) ? readFileSync(output, 'utf8') : null
    if (committed === content) {
      console.log(`gen-scoped-events: ${OUT} is up to date.`)
      return
    }
    console.error(`gen-scoped-events: ${OUT} is stale. Run \`pnpm run gen-scoped-events\` and commit it.`)
    process.exit(1)
  }
  writeFileSync(output, content)
  console.log(`gen-scoped-events: wrote ${OUT}.`)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  main()
}
