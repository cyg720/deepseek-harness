/** Test-only loader for fixed SQLite fixtures. */
/**
 * 文件职责：为 SQLite 持久化测试按受限名称加载固定 SQL 资源。
 * 技术维度：使用 TypeScript 字符串字面量联合、import.meta.url 和同步 UTF-8 文件读取。
 * 产品维度：让数据库迁移、损坏检测和流量测试复用可审查的 SQL，而不是在测试中拼接语句。
 * 逻辑维度：TestSqlName 列举允许资源；testSql 根据名称构造相邻资源 URL 并返回文本。
 * 关键边界：只能读取联合类型中的已知文件；函数仅供测试，且同步读取会阻塞当前线程。
 * 新手阅读建议：先按名称理解每个夹具场景，再到 resources/sql 查看实际语句。
 */

import { readFileSync } from 'node:fs'

// TestSqlName：固定 SQL 资源白名单；新增文件必须同步加入此联合类型。
export type TestSqlName =
  | 'add-unexpected-column'
  | 'count-events'
  | 'count-ignorable-events'
  | 'count-packed-events'
  | 'count-physical-types'
  | 'create-loose-schema'
  | 'create-unrelated-table'
  | 'delete-persistence-state'
  | 'delete-session-events'
  | 'empty-store-id'
  | 'insert-corrupt-event'
  | 'measure-write-traffic'
  | 'replace-events-with-nonstrict-table'
  | 'select-last-event'
  | 'select-event-rowids'
  | 'select-event-rows'
  | 'select-user-version'
  | 'set-application-id-12345'
  | 'set-user-version-15'
  | 'set-user-version-16'
  | 'set-user-version-17'
  | 'update-invalid-session-metadata'

/** Load one fixed test SQL resource. */
/**
 * 按白名单名称读取一个固定测试 SQL 文件。
 * @param name - TestSqlName 中声明的资源基名，不包含目录和 .sql 后缀。
 * @returns 对应资源的 UTF-8 SQL 文本。
 * @example testSql('count-events')。
 */
export function testSql(name: TestSqlName): string {
  return readFileSync(new URL(`./resources/sql/${name}.sql`, import.meta.url), 'utf8')
}
