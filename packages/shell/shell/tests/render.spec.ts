/**
 * Shared exit-status parse contract: the inverse of the `[exit code: N]` /
 * `[killed by signal: X]` markers `dsh-tool-bash` and `dsh-tool-pwsh` append.
 * Both tools' presenter suites round-trip their own renderers through this
 * parse; this spec pins the parse's own edges (marker-like output, body
 * slicing) once, at the seam that owns it.
 */
/*
 * 文件职责：验证 shell 输出末尾退出码、信号和超时标记的共享反解析规则。
 * 技术维度：使用 Vitest 对纯 parseExitStatus 函数进行字符串边界测试。
 * 产品维度：让 Bash 与 PowerShell 工具卡正确展示正文、退出码和终止信号，不误判用户输出。
 * 逻辑维度：覆盖无标记、非零退出、信号终止和超时正文四类输入。
 * 关键边界：标记必须有前导换行并位于字符串末尾；无对应 UI pill 的超时文本保留在正文。
 * 新手阅读建议：按四个用例观察输入尾部如何决定 body、exitCode 或 signal。
 */

import { describe, expect, it } from 'vitest'
import { parseExitStatus } from '../src/render.ts'

// Shell 退出状态解析测试套件。
describe('parseExitStatus', () => {
  // 验证无标记时正文逐字保留且默认退出码 0。
  it('recovers a clean exit 0 with the body verbatim when no marker is present', () => {
    expect(parseExitStatus('hi\n\n')).toEqual({ body: 'hi\n\n', exitCode: 0 })
    expect(parseExitStatus('')).toEqual({ body: '', exitCode: 0 })
  })

  // 验证只剥离末尾非零退出标记。
  it('recovers a non-zero exit and strips only its marker from the body', () => {
    expect(parseExitStatus('oops\n[exit code: 3]')).toEqual({ body: 'oops', exitCode: 3 })
    // The marker needs the leading newline and the end of the string, so a
    // clean result whose output merely ENDS in marker-like text is not read
    // as a failure and the text stays in the body.
    // 标记必须有前导换行且位于末尾；纯 marker-like 用户输出仍按成功正文处理。
    expect(parseExitStatus('[exit code: 5]')).toEqual({ body: '[exit code: 5]', exitCode: 0 })
  })

  // 验证末尾信号标记优先恢复 signal。
  it('recovers a signal kill ahead of any non-zero exit marker', () => {
    expect(parseExitStatus('gone\n[killed by signal: SIGKILL]')).toEqual({ body: 'gone', signal: 'SIGKILL' })
    // A fake signal marker with no leading newline is output, not a kill.
    // 没有前导换行的伪信号标记是普通输出，不是进程终止。
    expect(parseExitStatus('[killed by signal: SIGKILL]')).toEqual({ body: '[killed by signal: SIGKILL]', exitCode: 0 })
  })

  // 验证超时标记留在正文，只解析其后的退出码。
  it('keeps markers no pill shows (timeout) in the body', () => {
    expect(parseExitStatus('slow\n[timed out after 100ms]\n[exit code: 143]'))
      .toEqual({ body: 'slow\n[timed out after 100ms]', exitCode: 143 })
  })
})
