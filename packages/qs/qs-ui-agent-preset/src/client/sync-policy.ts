/** 设置持久化和空白会话同步分别确认，部分失败不能伪装成设置未保存。 */
import type { QsPresetPolicy } from './policy.ts'
import type { QsPresetSeat } from './seat.ts'
import type { QsPresetRoster } from './roster.ts'
/**
 * 组合设置保存与已捕获空白会话同步，不改变底层持久化所有权。
 * @param policy - 带版本校验的官方设置写入器。
 * @param seat - 捕获会话及连接代次的选择器。
 * @param roster - 保存后重新读取的生效目录。
 * @returns 向设置控件提供明确部分失败结果的写入器。
 */
export function syncPolicy(policy: QsPresetPolicy, seat: Pick<QsPresetSeat, 'captureDefaultSync'>, roster: QsPresetRoster): QsPresetPolicy {
  return { ...policy, save: async (change, revision) => {
    const sync = seat.captureDefaultSync()
    const outcome = await policy.save(change, revision)
    if (outcome !== 'written') return outcome
    await roster.refresh()
    const source = roster.getSnapshot()
    const id = source.roster?.presets.find(row => row.isDefault)?.id
    if (source.status !== 'ready' || id === undefined) return 'syncFailed'
    return await sync(id) ? 'written' : 'syncFailed'
  } }
}
