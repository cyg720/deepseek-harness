/**
 * Acceptance-path coverage for the rescope codemod's exact-edit classifier: a
 * duplicated insertion — what a non-idempotent apply produces — must be
 * rejected rather than applied again.
 */
/*
 * 中文说明：
 * - 文件职责：验证 vendored 源码重定域 codemod 能准确分类待应用、已应用和无效编辑状态。
 * - 技术维度：使用 Vitest 和纯字符串精确计数分类函数。
 * - 产品维度：防止同步 vendored Cordis 时重复插入、误删或在上游移动位置继续错误修改。
 * - 逻辑维度：分别构造插入、删除、替换的源形式与目标形式，覆盖正常和重复/残缺状态。
 * - 关键边界：分类依赖精确文本及期望出现次数；任何混合或丢失余段都视为 invalid。
 * - 新手阅读建议：对每组先找 pending 的源文本，再看 applied 目标文本，最后理解 invalid 的歧义。
 */

import { describe, expect, it } from 'vitest'
import { exactEditState } from './rescope-vendor.ts'

/** 同步文档中的固定插入锚点。 */
const ANCHOR = '\n## Sync procedure'
/** 包含锚点的完整目标插入文本。 */
const INSERTED = `\n15. **rescope**: one log entry.\n${ANCHOR}`

/** 中文：exactEditState 对插入、删除和替换的分类测试组。 */
describe('exactEditState', () => {
  /** 中文：插入按目标形式计数，重复目标必须判 invalid；无参数和返回值。 */
  it('classifies an insertion by its target form, so a duplicate is invalid', () => {
    expect(exactEditState(`log\n${ANCHOR}\n`, ANCHOR, INSERTED, 1)).toBe('pending')
    expect(exactEditState(`log${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('applied')
    // The anchor survives an insertion, so counting the source form would have
    // called this pending and inserted the entry a second time.
    // 中文：插入后锚点仍存在，因此若只数源锚点会误判为 pending 并再次插入。
    expect(exactEditState(`log${INSERTED}${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('invalid')
    expect(exactEditState('log\n', ANCHOR, INSERTED, 1)).toBe('invalid')
  })

  /** 中文：删除按源形式判断，同时要求目标余段仍存在；无参数和返回值。 */
  it('classifies a deletion by its source form, and requires its remainder to survive', () => {
    /** 删除后必须保留的字段头。 */
    const remainder = 'exclude:\n'
    /** 删除前包含一个条目的完整源文本。 */
    const withEntries = 'exclude:\n  - cordis@4\n'
    expect(exactEditState(withEntries, withEntries, remainder, 1)).toBe('pending')
    expect(exactEditState(remainder, withEntries, remainder, 1)).toBe('applied')
    // Upstream dropped the whole field: the source form is gone, but so is the
    // remainder, so this is a moved site rather than a completed deletion.
    // 中文：若上游连字段都删除，源虽消失但余段也不存在，应视为位置移动而不是删除已完成。
    expect(exactEditState('unrelated:\n', withEntries, remainder, 1)).toBe('invalid')
  })

  /** 中文：替换必须完全移除源形式并留下精确数量目标；无参数和返回值。 */
  it('requires a replacement to leave no source form and the exact target count', () => {
    expect(exactEditState('a = 1\n', 'a = 1', 'b = 2', 1)).toBe('pending')
    expect(exactEditState('b = 2\n', 'a = 1', 'b = 2', 1)).toBe('applied')
    expect(exactEditState('b = 2\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    // A moved or partially applied site: neither state is complete.
    // 中文：源和目标同时存在代表位置移动或部分应用，不能认定完成。
    expect(exactEditState('a = 1\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    expect(exactEditState('x\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
  })
})
