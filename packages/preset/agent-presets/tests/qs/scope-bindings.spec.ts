/** Loader 所有者可以恢复自己的重绑定权限，其他所有者仍受单次绑定约束。 */
import { expect, it } from 'vitest'
import { bindScopeParent, scopeParentOf } from '@deepseek-ai/dsh-scope'
import { presetScopeBindings } from '../../src/qs/scope-bindings.ts'

it('retains the original binding only for its registration owner', () => {
  const owner = {}, otherOwner = {}, agent = {}, first = {}, next = {}
  presetScopeBindings(owner).set(agent, bindScopeParent(agent, first))
  expect(presetScopeBindings(otherOwner).get(agent)).toBeUndefined()
  expect(() => bindScopeParent(agent, next)).toThrow('already bound')
  expect(scopeParentOf(agent)).toBe(first)
  const retained = presetScopeBindings(owner).get(agent)
  if (retained === undefined) throw new Error('Original registration lost its binding')
  retained.rebind(next)
  expect(scopeParentOf(agent)).toBe(next)
})
