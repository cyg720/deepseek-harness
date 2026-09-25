/** 权限机器值不翻译；完全访问保留显式确认，自定义名称保持原文。 */
import { expect, it } from 'vitest'
import { permissionOptions } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
it('隐藏 custom 目标，保留活动值、描述、自定义标签及风险确认', () => {
  const result = permissionOptions({ currentValue: 'workspace-write', options: [
    { value: 'custom', name: 'Custom' },
    { value: 'read-only', name: 'Read Only' },
    { value: 'workspace-write', name: 'workspace-write', description: 'host-owned description' },
    { value: 'danger-full-access', name: 'Full access' },
    { value: 'organization-policy', name: '组织策略' },
  ] }, key => zh[key])
  expect(result.map(row => row.id)).toEqual(['read-only', 'workspace-write', 'danger-full-access', 'organization-policy'])
  expect(result[0]).toEqual({ id: 'read-only', label: zh.readOnly })
  expect(result[1]).toEqual({ id: 'workspace-write', label: zh.workspaceWrite, detail: 'host-owned description', active: true })
  expect(result[2]?.confirmation).toEqual({ title: zh.riskTitle, description: zh.riskDescription,
    acknowledgeLabel: zh.acknowledge, cancelLabel: zh.cancel, confirmLabel: zh.confirm })
  expect(result[3]?.label).toBe('组织策略')
  expect(permissionOptions({ currentValue: 'workspace-write', options: [{ value: 'workspace-write', name: 'Workspace Write' }] }, key => zh[key])[0]?.label)
    .toBe(zh.workspaceWrite)
  expect(permissionOptions({ currentValue: 'custom', options: [{ value: 'read-only', name: '组织自定义只读' }] }, key => zh[key]))
    .toEqual([{ id: 'read-only', label: '组织自定义只读' }])
})
