/**
 * Closed, package-owned SQL resource loading for SQLite.
 * @module @deepseek-ai/dsh-session-persistence-sqlite/sql
 */
/*
 * 文件职责：按封闭资源名同步加载并缓存 SQLite 包拥有的 SQL 语句。
 * 技术维度：使用 TypeScript const 元组、派生联合类型、import.meta.url 和 Map 缓存。
 * 产品维度：保证会话数据库只执行随包发布且经过审查的 SQL 文件，并避免重复磁盘读取。
 * 逻辑维度：SQL_RESOURCES 定义允许列表；sql 先查缓存，未命中时解析资源 URL、读文本、缓存并返回。
 * 关键边界：调用方不能传任意路径；资源文件必须随发布包位于 resources/sql，文本加载后视为不可变。
 * 新手阅读建议：先看允许列表和 SqlResourceName 的关系，再沿 cache 命中/未命中两条路径阅读 sql。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 包内允许加载的 SQL 基名封闭列表；新增资源必须显式加入并随包发布。
const SQL_RESOURCES = [
  'begin',
  'begin-immediate',
  'commit',
  'delete-events-from',
  'foreign-keys-on',
  'insert-event',
  'insert-persistence-state',
  'journal-mode-delete',
  'journal-mode-persist',
  'journal-mode-truncate',
  'journal-mode-wal',
  'mmap-off',
  'rollback',
  'schema',
  'select-application-id',
  'select-events',
  'select-events-from',
  'select-mmap-size',
  'select-packed-predecessors',
  'select-schema-objects',
  'select-session',
  'select-sessions',
  'select-store-id',
  'select-synchronous',
  'select-tail-events',
  'select-trusted-schema',
  'select-user-object-count',
  'select-user-version',
  'set-application-id',
  'set-user-version-17',
  'synchronous-full',
  'trusted-schema-off',
  'update-session-revision',
  'upsert-session',
] as const

/** A resource basename selected exclusively by package code. */
/* 只能由包代码选择的 SQL 资源基名联合类型。 */
export type SqlResourceName = typeof SQL_RESOURCES[number]

// 已加载 SQL 文本缓存；键为封闭资源名，值为 UTF-8 语句文本。
const cache = new Map<SqlResourceName, string>()

/**
 * Load an immutable SQL statement by closed resource name.
 * @param name - package-owned resource basename.
 * @returns the resource text.
 */
/*
 * 加载不可变 SQL 语句。@param name 包拥有的资源基名。@returns UTF-8 SQL 文本。@example sql('begin')。
 * @param name 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function sql(name: SqlResourceName): string {
  // 之前读取并缓存的语句；存在时避免再次访问磁盘。
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  // 从当前模块相邻的发布资源目录同步读取的 SQL 文本。
  const statement = readFileSync(
    fileURLToPath(new URL(`../resources/sql/${name}.sql`, import.meta.url)),
    'utf8',
  )
  cache.set(name, statement)
  return statement
}
