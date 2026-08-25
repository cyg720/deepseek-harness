/**
 * workspaceWriteSid tests: the per-workspace write identity is deterministic
 * (the same canonical path always derives the same SID — the property the
 * cross-session grant reuse rests on), capability-shaped, distinct across
 * workspaces, and byte-sensitive (the canonical path is the caller's
 * contract; an alias spelling derives a second identity, self-healing at
 * the cost of one extra tree propagation).
 */
/*
 * 中文说明：
 * - 文件职责：验证 Windows ACL 工作区和私有临时目录写权限 SID 的确定性、区分度与格式。
 * - 技术维度：使用 Vitest、路径字符串输入和正则表达式检查能力 SID 编码。
 * - 产品维度：保障同一目录可复用授权，不同权限域不会意外共享写入身份。
 * - 逻辑维度：分别测试工作区 SID 和临时 SID 的稳定、差异、字节敏感及域分离属性。
 * - 关键边界：函数按调用者给出的规范路径字节计算，不会自行统一大小写或尾分隔符。
 * - 新手阅读建议：先比较相同与不同路径，再关注 tempWriteSid 末尾域标记及与工作区 SID 的差异。
 */

import { describe, expect, it } from 'vitest'

import { tempWriteSid, workspaceWriteSid } from '../src/index.ts'

/** 中文：工作区写权限 SID 的派生属性测试组。 */
describe('workspaceWriteSid', () => {
  /** 中文：同一路径两次派生应相同且符合 SID 格式；无参数和返回值。 */
  it('derives a stable capability-shaped SID per workspace path', () => {
    /** 第一次派生的工作区 SID。 */
    const first = workspaceWriteSid('C:\\Users\\agent\\repo')
    /** 使用相同路径第二次派生的 SID。 */
    const second = workspaceWriteSid('C:\\Users\\agent\\repo')
    expect(first).toBe(second)
    expect(first).toMatch(/^S-1-4-\d+-\d+$/u)
  })

  /** 中文：不同工作区路径必须派生不同身份；无参数和返回值。 */
  it('derives distinct identities for distinct workspaces', () => {
    expect(workspaceWriteSid('C:\\Users\\agent\\repo-a')).not.toBe(workspaceWriteSid('C:\\Users\\agent\\repo-b'))
  })

  /** 中文：大小写或尾分隔符不同都会改变输入字节并产生新身份；无参数和返回值。 */
  it('is byte-sensitive: the canonical path is the caller\'s contract (an alias spelling derives a second identity)', () => {
    expect(workspaceWriteSid('C:\\Repo')).not.toBe(workspaceWriteSid('c:\\repo'))
    expect(workspaceWriteSid('C:\\Repo\\')).not.toBe(workspaceWriteSid('C:\\Repo'))
  })
})

/** 中文：私有临时目录写权限 SID 的域分离测试组。 */
describe('tempWriteSid', () => {
  /** 中文：同一临时路径派生稳定且不会与工作区 SID 相同；无参数和返回值。 */
  it('derives a stable domain-separated SID per private temp path', () => {
    /** 私有临时目录的首次派生 SID。 */
    const temp = tempWriteSid('C:\\Users\\agent\\AppData\\Local\\Temp\\dsh-abc123')
    expect(temp).toBe(tempWriteSid('C:\\Users\\agent\\AppData\\Local\\Temp\\dsh-abc123'))
    expect(temp).toMatch(/^S-1-4-\d+-\d+-1$/u)
    expect(temp).not.toBe(workspaceWriteSid('C:\\Users\\agent\\AppData\\Local\\Temp\\dsh-abc123'))
  })

  /** 中文：不同临时路径必须得到不同能力身份；无参数和返回值。 */
  it('derives distinct capabilities for distinct private temp paths', () => {
    expect(tempWriteSid('C:\\Temp\\dsh-a')).not.toBe(tempWriteSid('C:\\Temp\\dsh-b'))
  })
})
