// @vitest-environment jsdom
/** 持久字段读取层：解析成功与各种结构不符都必须回落到 undefined。 */
import { expect, it } from 'vitest'
import { formatSpillNotice } from '@deepseek-ai/dsh-spill-policy/notice'
import { SpillLocator } from '@deepseek-ai/dsh-spill'
import {
  blockType, booleanArg, callHead, contentSummary, hasSpill, isSettled, parseArgs, parseExitStatus,
  singleText, stringArg,
} from '../src/client/raw-tool-call.ts'
import { blocks, resultNode, runningCall } from './tool-fixtures.client.ts'

it('区分运行头与结算结果，并从结算结果取回调用头', () => {
  const running = runningCall()
  expect(isSettled(running)).toBe(false)
  expect(callHead(running)).toEqual({ name: 'bash', argsRaw: '{"command":"ls"}' })
  const settled = resultNode()
  expect(isSettled(settled)).toBe(true)
  expect(callHead(settled)).toEqual({ name: 'bash', argsRaw: '{"command":"ls"}' })
  // 窗口截断：结果先到而调用头不在窗口内，只能给出 callId。
  expect(callHead(resultNode({ call: null }))).toBeUndefined()
})

it('参数解析只在顶层对象时才成立', () => {
  expect(parseArgs('')).toBeUndefined()
  expect(parseArgs('not json')).toBeUndefined()
  expect(parseArgs('[1,2]')).toBeUndefined()
  expect(parseArgs('"text"')).toBeUndefined()
  expect(parseArgs('{"a":1}')).toEqual({ a: 1 })
})

it('字符串与布尔参数按类型收窄，空串视为缺失', () => {
  const args = { name: 'x', empty: '', count: 3, flag: true }
  expect(stringArg(args, 'name')).toBe('x')
  expect(stringArg(args, 'empty')).toBeUndefined()
  expect(stringArg(args, 'count')).toBeUndefined()
  expect(stringArg(undefined, 'name')).toBeUndefined()
  expect(booleanArg(args, 'flag')).toBe(true)
  expect(booleanArg(args, 'name')).toBeUndefined()
})

it('单文本结果要求内容恰好一个文本块', () => {
  expect(singleText(resultNode({ content: [{ type: 'text', text: 'body' }] }))).toBe('body')
  expect(singleText(resultNode({ content: [] }))).toBeUndefined()
  expect(singleText(resultNode({ content: blocks({ type: 'text', text: 'a' }, { type: 'text', text: 'b' }) }))).toBeUndefined()
  expect(singleText(resultNode({ content: blocks({ type: 'image', attachment: {} }) }))).toBeUndefined()
})

it('内容摘要分离文本块与非文本块，并给出类型名', () => {
  expect(blockType({ type: 'image' })).toBe('image')
  expect(blockType({ type: 7 })).toBeUndefined()
  expect(blockType('image')).toBeUndefined()
  const summary = contentSummary([
    { type: 'text', text: 'first' },
    { type: 'image', attachment: { attachmentId: 'a' } },
    { noType: true },
    { type: 'text', text: 'second' },
  ])
  expect(summary.text).toBe('first\n\nsecond')
  expect(summary.nonTextKinds).toEqual(['image', 'unknown'])
  expect(summary.nonTextRaw).toEqual([{ type: 'image', attachment: { attachmentId: 'a' } }, { noType: true }])
})

it('退出状态只认官方写在尾部的标记，缺标记时如实报告未报告', () => {
  expect(parseExitStatus('done')).toEqual({ body: 'done', reported: false, exitCode: 0, signal: undefined })
  expect(parseExitStatus('out\n[exit code: 3]')).toEqual({ body: 'out', reported: true, exitCode: 3, signal: undefined })
  expect(parseExitStatus('out\n[killed by signal: SIGTERM]')).toEqual({
    body: 'out', reported: true, exitCode: 0, signal: 'SIGTERM',
  })
  // 标记必须紧贴末尾：中间出现的方括号不是退出标记。
  expect(parseExitStatus('[exit code: 3]\nmore').reported).toBe(false)
})

it('转存提示按官方文本约定识别', () => {
  expect(hasSpill('plain output')).toBe(false)
  // 用官方格式化器造样本：识别的是同一套文本约定，不是手抄的近似串。
  const notice = formatSpillNotice({ kind: 'exact', count: 128 }, {
    locator: SpillLocator('/tmp/full.txt'),
    retrievalHint: 'Read the file to see everything.',
  })
  expect(hasSpill(`preview

${notice}`)).toBe(true)
})
