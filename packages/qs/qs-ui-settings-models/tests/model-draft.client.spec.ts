/** 模型容量与草稿校验独立于网络，保留未编辑的扩展字段。 */
import { expect, it } from 'vitest'
import { modelCapacity, modelDrafts, modelFailure, modelValues } from '../src/client/model-draft.ts'

it.each([['', undefined], [' 1K ', 1000], ['2.3m', 2300000], ['123', 123], ['1.5', 1.5]] as const)(
  '容量 %s 转换为 token 数', (input, expected) => { expect(modelCapacity(input)).toBe(expected) },
)
it.each(['abc', '-1', '1e6'])('非法容量 %s 不伪造成数值', (input) => { expect(modelCapacity(input)).toBeNaN() })
it('保留扩展字段，空名称和容量删除对应覆盖', () => {
  const source = [{ id: 'model', name: 'name', contextWindow: 1024, maxTokens: 256, future: { enabled: true } }]
  const rows = modelDrafts(source)
  const values = modelValues([{ ...rows[0]!, id: ' model ', name: '', contextWindow: '', maxTokens: '2K' }])
  expect(values).toEqual([{ id: 'model', maxTokens: 2000, future: { enabled: true } }])
  expect(source[0]).toMatchObject({ name: 'name', contextWindow: 1024 })
  expect(modelValues(modelDrafts([{ id: 'model', name: 'name' }]))).toEqual([{ id: 'model', name: 'name' }])
})
it('读取缺省和不完整草稿，不把空标识或重复标识当成有效模型', () => {
  expect(modelDrafts(undefined)).toEqual([])
  expect(modelFailure(modelDrafts([null]))).toBe('modelIdInvalid')
  expect(modelFailure(modelDrafts([{ id: 'same' }, { id: ' same ' }]))).toBe('modelDuplicate')
  expect(modelFailure(modelDrafts([{ id: 'one' }, { id: 'two' }]))).toBeUndefined()
})
it.each(['0', '1.5', 'oops', '9007199254740992'])('容量 %s 阻止保存', (text) => {
  const row = modelDrafts([{ id: 'model' }])[0]!
  expect(modelFailure([{ ...row, contextWindow: text }])).toBe('modelCapacityInvalid')
})
