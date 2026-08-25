/**
 * 文件职责：验证 sql-resource-boundary.spec.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** 中文说明：常量 PACKAGE_ROOT 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url))
/** 中文说明：常量 SQL_LITERAL 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SQL_LITERAL = /^\s*(?:ALTER|ATTACH|BEGIN|COMMIT|CREATE|DELETE|DETACH|DROP|INSERT|PRAGMA|REINDEX|RELEASE|ROLLBACK|SAVEPOINT|SELECT|UPDATE|VACUUM|WITH)\s/iu // eslint-disable-line @stylistic/max-len

/** 中文说明：函数 filesUnder 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function filesUnder(path: string): Promise<string[]> {
  /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = await readdir(path, { withFileTypes: true })
  return (await Promise.all(entries.map(async entry => entry.isDirectory()
    ? filesUnder(`${path}/${entry.name}`)
    : [`${path}/${entry.name}`]))).flat()
}

/** 中文说明：函数 sqlLiteralText 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function sqlLiteralText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TemplateHead) {
    return (node as ts.Node & { readonly text: string }).text
  }
  return undefined
}

/** 中文说明：函数 isOwnedSqlSource 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function isOwnedSqlSource(node: ts.Expression | undefined, source: ts.SourceFile): boolean {
  if (node === undefined) return false
  if (ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && (node.expression.text === 'sql' || node.expression.text === 'testSql')) return true
  if (!ts.isIdentifier(node) || node.text !== 'source') return false
  /** 中文说明：变量 call 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const call = node.parent
  if (!ts.isCallExpression(call)
    || call.arguments.length !== 1
    || call.arguments[0] !== node
    || !ts.isPropertyAccessExpression(call.expression)
    || call.expression.expression.kind !== ts.SyntaxKind.SuperKeyword
    || call.expression.name.text !== 'prepare') return false
  /** 中文说明：变量 method 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let method: ts.Node | undefined = node.parent
  while (method !== undefined && !ts.isMethodDeclaration(method)) method = method.parent
  if (method === undefined
    || method.name.getText(source) !== 'prepare'
    || method.parameters.length !== 1
    || method.parameters[0]?.name.getText(source) !== 'source') return false
  /** 中文说明：变量 classNode 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let classNode: ts.Node | undefined = method.parent
  while (classNode !== undefined && !ts.isClassExpression(classNode)) classNode = classNode.parent
  if (classNode === undefined || classNode.name?.text !== 'JournalFailureDatabase') return false
  /** 中文说明：变量 guard 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const guard = method.body?.statements[0]
  if (guard === undefined
    || !ts.isIfStatement(guard)
    || !ts.isBinaryExpression(guard.expression)
    || guard.expression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
    || guard.expression.left.getText(source) !== 'source'
    || guard.expression.right.getText(source) !== "sql('journal-mode-wal')") return false
  return ts.isReturnStatement(guard.thenStatement)
    && guard.thenStatement.expression === call
}

describe('SQLite SQL resource boundary', () => {
  it('keeps statements and query assembly out of TypeScript files', async () => {
    /** 中文说明：变量 files 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const files = (await Promise.all([
      filesUnder(`${PACKAGE_ROOT}/src`),
      filesUnder(`${PACKAGE_ROOT}/tests`),
    ])).flat().filter(path => path.endsWith('.ts'))
    /** 中文说明：变量 violations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const violations: string[] = []
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const path of files) {
      /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
      /** 中文说明：函数值 usesNodeSqlite 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const usesNodeSqlite = source.statements.some(statement => ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === 'node:sqlite')
      /** 中文说明：函数值 visit 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const visit = (node: ts.Node): void => {
        /** 中文说明：变量 literal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const literal = sqlLiteralText(node)
        if (literal !== undefined && SQL_LITERAL.test(literal)) {
          violations.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: SQL literal`)
        }
        // Awaited prepare() is SessionPersistence; DatabaseSync.prepare() is synchronous.
        if (usesNodeSqlite
          && ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && (node.expression.name.text === 'exec'
            || (node.expression.name.text === 'prepare' && !ts.isAwaitExpression(node.parent)))) {
          /** 中文说明：变量 argument 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const argument = node.arguments[0]
          if (!isOwnedSqlSource(argument, source)) {
            violations.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: unowned query source`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(violations).toEqual([])
  })

  it('keeps resource text static instead of interpolated', async () => {
    /** 中文说明：变量 files 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const files = (await Promise.all([
      filesUnder(`${PACKAGE_ROOT}/resources/sql`),
      filesUnder(`${PACKAGE_ROOT}/tests/resources/sql`),
    ])).flat()
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const path of files) {
      expect(path.endsWith('.sql')).toBe(true)
      expect(await readFile(path, 'utf8')).not.toContain('${')
    }
  })
})
