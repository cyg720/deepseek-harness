/** 选项查找保留完整路由，禁止分隔符碰撞及跨模型沿用强度。 */
import { expect, it } from 'vitest'
import { modelChoices, selectionOf } from '../src/client/selection.ts'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { apply } from '../src/index.ts'
it('同一模型保留明确强度，换模型使用它的默认值，未知选项拒绝', () => {
  apply()
  const state: ModelDirectoryState = { current: { provider: 'a/b', model: 'c', reasoningEffort: 'max' },
    routable: true, status: 'ready', error: null, failures: [], groups: [
      { id: 'a/b', name: 'First', models: [{ id: 'c', name: '<img>', reasoning: { efforts: [{ id: 'max', name: 'Maximum' }], defaultEffort: 'max' } }] },
      { id: 'a', name: 'Second', models: [{ id: 'b/c', name: 'Other', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } },
        { id: 'simple', name: 'Simple' }] },
    ] }
  const rows = modelChoices(state)
  expect(new Set(rows.map(row => row.id)).size).toBe(3)
  expect(selectionOf(state, rows[0]!.id)).toEqual({ provider: 'a/b', model: 'c', reasoningEffort: 'max' })
  expect(selectionOf(state, rows[1]!.id)).toEqual({ provider: 'a', model: 'b/c', reasoningEffort: 'low' })
  expect(selectionOf(state, rows[2]!.id)).toEqual({ provider: 'a', model: 'simple' })
  expect(selectionOf(state, 'missing')).toBeUndefined()
  state.current = { provider: 'a', model: 'b/c' }
  expect(modelChoices(state)[1]!.selection.reasoningEffort).toBe('low')
  state.current = null; expect(modelChoices(state)).toHaveLength(3)
})
