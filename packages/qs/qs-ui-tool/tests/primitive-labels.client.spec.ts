// @vitest-environment jsdom
/** primitives 标签组装：每个函数型标签都必须按参数产出文案。 */
import { expect, it } from 'vitest'
import {
  diffLabels, readLabels, searchLabels, terminalLabels, webLabels,
} from '../src/client/primitive-labels.ts'
import { zh } from '../src/client/locales.ts'

/** 以中文词典为源、参数序列化后附在文案后的翻译座席。 */
const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  `${zh[key]}${params === undefined ? '' : `|${Object.values(params).join(',')}`}`) as never

it('终端标签覆盖状态、复制与展开文案', () => {
  const labels = terminalLabels(t)
  expect(labels.signal('SIGKILL')).toBe(`${zh['terminal.signal']}|SIGKILL`)
  expect(labels.exitCode(2)).toBe(`${zh['terminal.exitCode']}|2`)
  expect(labels.running).toBe(zh['terminal.running'])
  expect(labels.failed).toBe(zh['terminal.failed'])
  expect(labels.done).toBe(zh['terminal.done'])
  expect(labels.copy).toBe(zh['terminal.copy'])
  expect(labels.copied).toBe(zh['terminal.copied'])
  expect(labels.noOutput).toBe(zh['terminal.noOutput'])
  expect(labels.collapseAria).toBe(zh['terminal.collapseAria'])
  expect(labels.collapse).toBe(zh['terminal.collapse'])
  expect(labels.expandAria(5)).toBe(`${zh['terminal.expandAria']}|5`)
  expect(labels.expand(5)).toBe(`${zh['terminal.expand']}|5`)
})

it('读取标签覆盖行窗口与展开文案', () => {
  const labels = readLabels(t)
  expect(labels.window(3, 9)).toBe(`${zh['read.window']}|3,9`)
  expect(labels.copy).toBe(zh['read.copy'])
  expect(labels.copied).toBe(zh['read.copied'])
  expect(labels.collapseAria).toBe(zh['read.collapseAria'])
  expect(labels.collapse).toBe(zh['read.collapse'])
  expect(labels.expandAria(2)).toBe(`${zh['read.expandAria']}|2`)
  expect(labels.expand(2)).toBe(`${zh['read.expand']}|2`)
})

it('差异标签覆盖文件数与展开文案', () => {
  const labels = diffLabels(t)
  expect(labels.files(2)).toBe(`${zh['diff.files']}|2`)
  expect(labels.copy).toBe(zh['diff.copy'])
  expect(labels.copied).toBe(zh['diff.copied'])
  expect(labels.collapseAria).toBe(zh['diff.collapseAria'])
  expect(labels.collapse).toBe(zh['diff.collapse'])
  expect(labels.expandAria(1)).toBe(`${zh['diff.expandAria']}|1`)
  expect(labels.expand(1)).toBe(`${zh['diff.expand']}|1`)
})

it('搜索标签按截断与否选择文案', () => {
  const labels = searchLabels(t)
  expect(labels.pathsSummary(2, 9, false)).toBe(`${zh['search.paths']}|2`)
  expect(labels.pathsSummary(2, 9, true)).toBe(`${zh['search.pathsTruncated']}|2,9`)
  expect(labels.matchesSummary(2, 9, 3, false)).toBe(`${zh['search.matches']}|2,3`)
  expect(labels.matchesSummary(2, 9, 3, true)).toBe(`${zh['search.matchesTruncated']}|2,9,3`)
  expect(labels.copy).toBe(zh['search.copy'])
  expect(labels.copied).toBe(zh['search.copied'])
  expect(labels.noResults).toBe(zh['search.noResults'])
  expect(labels.collapseAria).toBe(zh['search.collapseAria'])
  expect(labels.collapse).toBe(zh['search.collapse'])
  expect(labels.expandAria(4)).toBe(`${zh['search.expandAria']}|4`)
  expect(labels.expand(4)).toBe(`${zh['search.expand']}|4`)
})

it('Web 标签包含状态文案与 Markdown 子标签', () => {
  const labels = webLabels(t)
  expect(labels.noResults).toBe(zh['web.noResults'])
  expect(labels.sourcesTruncated).toBe(zh['web.sourcesTruncated'])
  expect(labels.http).toBe(zh['web.http'])
  expect(labels.contentTruncated).toBe(zh['web.contentTruncated'])
  expect(labels.markdown.code.copyLabel).toBe(zh['markdown.copy'])
  expect(labels.markdown.code.copiedLabel).toBe(zh['markdown.copied'])
  expect(labels.markdown.footnotes).toBe(zh['markdown.footnotes'])
})
