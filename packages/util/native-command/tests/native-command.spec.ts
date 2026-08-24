import { describe, expect, it } from 'vitest'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'

// 当前 Node 可执行路径，作为可预测的跨平台测试命令。
const node = process.execPath

// 原生命令运行器测试套件。
describe('runNativeCommand', () => {
  // 验证退出 0 时同时捕获 UTF-8 stdout/stderr。
  it('captures utf8 stdout and stderr on exit 0', async () => {
    // 成功命令返回结果。
    const result = await runNativeCommand(
      node,
      ['-e', 'process.stdout.write("out✓"); process.stderr.write("err")'],
      new AbortController().signal,
    )
    expect(result).toEqual({ stdout: 'out✓', stderr: 'err' })
  })

  // 验证非零退出拒绝且附加 code/stdout/stderr/cause。
  it('rejects a non-zero exit with code, stdout, and stderr attached', async () => {
    // 捕获的非零退出失败对象。
    const failure = await runNativeCommand(
      node,
      ['-e', 'process.stdout.write("partial"); process.stderr.write("boom"); process.exit(3)'],
      new AbortController().signal,
    ).then(() => { throw new Error('unexpected resolve') }, (error: unknown) => error)
    expect(failure).toMatchObject({ code: 3, stdout: 'partial', stderr: 'boom' })
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })

  // 验证不存在可执行文件报告 spawn ENOENT。
  it('rejects a missing executable with the spawn ENOENT code', async () => {
    // 捕获的缺命令失败对象。
    const failure = await runNativeCommand(
      'dsh-definitely-missing-command',
      [],
      new AbortController().signal,
    ).then(() => { throw new Error('unexpected resolve') }, (error: unknown) => error)
    expect(failure).toMatchObject({ code: 'ENOENT' })
  })

  // 验证 AbortSignal 会终止仍在等待的子进程。
  it('terminates the child when the signal aborts', async () => {
    // 本用例取消控制器。
    const abort = new AbortController()
    // 尚未完成的长时命令 Promise。
    const pending = runNativeCommand(node, ['-e', 'setTimeout(() => {}, 60_000)'], abort.signal)
    abort.abort()
    // 中止后捕获的失败对象。
    const failure = await pending.then(() => { throw new Error('unexpected resolve') }, (error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as { code?: unknown }).code).toBe('ABORT_ERR')
  })
})
/**
 * 文件职责：验证原生命令运行器捕获 UTF-8 输出、附加失败详情、报告缺失命令并响应取消。
 * 技术维度：使用 Vitest 和当前 Node 可执行文件构造跨平台真实子进程。
 * 产品维度：确保目录选择和默认应用等宿主集成获得一致的成功与失败诊断。
 * 逻辑维度：四个用例依次覆盖退出 0、退出 3、ENOENT 和 AbortController 中止。
 * 关键边界：所有命令都不经过 shell；长任务只用于取消测试并立即 abort。
 * 新手阅读建议：先看 node 常量，再比较 result 与 failure 的字段，最后看 abort/pending 时序。
 */
