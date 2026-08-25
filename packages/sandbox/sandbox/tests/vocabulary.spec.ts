/**
 * Vocabulary-contract tests for the sandbox seam: the fail-closed error's
 * structured identity is what tool results and consumers key on, so its
 * shape is pinned here, next to the vocabulary that owns it. Provider
 * behavior is each implementation's suite (`dsh-sandbox-local`); consumer
 * behavior is each consumer's (`dsh-bash-sandbox`).
 */
/*
 * 文件职责：固定沙箱不可用错误的结构化身份、操作提示和运行器失败详情。
 * 技术维度：使用 Vitest 检查 SandboxUnavailableError 的 Error 继承、代码和消息模板。
 * 产品维度：让工具和消费者可靠识别安全失败，并向操作员说明可选模式与底层原因。
 * 逻辑维度：三个用例分别检查 name/code、拒绝模式与逃生选项、执行期 runner 详情。
 * 关键边界：能力提供者行为在各自包测试；此处只拥有公共错误词汇约定。
 * 新手阅读建议：先看结构身份，再比较无 detail 和带 detail 构造时的消息差异。
 */

import { describe, expect, it } from 'vitest'
import { SANDBOX_UNAVAILABLE, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'

// 沙箱不可用错误词汇测试套件。
describe('SandboxUnavailableError', () => {
  // 验证消费者依赖的 name/code 结构。
  it('carries the structured { name, code } identity consumers key on', () => {
    // read-only 模式不可用错误。
    const error = new SandboxUnavailableError('read-only')
    expect(error.name).toBe('SandboxUnavailableError')
    expect(error.code).toBe(SANDBOX_UNAVAILABLE)
    expect(error).toBeInstanceOf(Error)
  })

  // 验证消息包含被拒模式和操作员可选择的放宽模式。
  it('names the refused mode and the operator escape hatches in its message', () => {
    // workspace-write 模式不可用错误。
    const error = new SandboxUnavailableError('workspace-write')
    expect(error.message).toContain('"workspace-write"')
    expect(error.message).toContain('danger-full-access')
    expect(error.message).not.toContain('Runner failure')
  })

  // 验证执行阶段发现失败时附带 runner 首行详情。
  it('carries the runner detail when the failure is discovered at execution time', () => {
    // The late twin of the confine-time throw: an unprobed sole candidate
    // that fails closed at exec surfaces the SAME error, with the runner's
    // own first stderr line as the cause.
    // 这是约束阶段抛错的执行期对应路径，必须使用同一错误类型并附带运行器首行。
    // 带 landlock 运行器详情的不可用错误。
    const error = new SandboxUnavailableError('read-only', 'landlock-run: landlock is not enforced by this kernel')
    expect(error.code).toBe(SANDBOX_UNAVAILABLE)
    expect(error.message).toContain('Runner failure: landlock-run: landlock is not enforced by this kernel')
  })
})
