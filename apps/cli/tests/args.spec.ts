/**
 * 文件职责：验证 dsh 参数解析对配置启动、web 别名、插件转发、配置导出和错误输入的处理。
 * 技术维度：使用 Vitest 和进程方法桩捕获 Commander 的退出行为及判别联合结果。
 * 产品维度：保证启动器与应用参数边界稳定，用户收到正确的调用模式、帮助和错误退出码。
 * 逻辑维度：封装固定版本解析与退出码捕获，依次覆盖成功路由、参数边界和拒绝场景。
 * 关键边界：测试会替换 process.exit/stdout/stderr，每个用例结束必须恢复全部桩。
 * 新手阅读建议：先看 parse 与 exitCode 两个辅助函数，再对比成功结果和退出码断言。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDshArgs } from '../src/args.ts'

/** 使用固定版本字符串解析测试参数；参数为 argv，返回 dsh 调用结果。 */
const parse = (argv: string[]) => parseDshArgs(argv, '1.2.3')

/** Capture the process exit code while muting Commander's output. */
/**
 * 静音 Commander 输出并捕获指定参数触发的进程退出码。
 * @param argv 预期会结束进程的参数。
 * @returns Commander 最后传给 process.exit 的退出码。
 * @example `exitCode(['--help'])`
 */
function exitCode(argv: string[]): number {
  /** 阻止真实退出并记录调用的 process.exit 桩。 */
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    parse(argv)
    throw new Error(`expected ${JSON.stringify(argv)} to exit`)
  } catch {
    return exit.mock.calls.at(-1)?.[0] as number
  } finally {
    vi.restoreAllMocks()
  }
}

/** 每个用例后恢复对进程输出和退出方法的替换。 */
afterEach(() => { vi.restoreAllMocks() })

describe('parseDshArgs', () => {
  /** 配置启动与 web 别名应解析为相同结构，并保留补丁顺序。 */
  it('routes profile boots and the web alias, handing the rest to the app', () => {
    expect(parse(['--profile', 'tui'])).toEqual({ mode: 'profile', profile: 'tui', patches: [], args: [] })
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--patch', 'b.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml', 'b.yml'], args: [] })
    expect(parse(['web'])).toEqual({ mode: 'profile', profile: 'web', patches: [], args: [] })
    expect(parse(['web', '--patch', 'web.yml']))
      .toEqual({ mode: 'profile', profile: 'web', patches: ['web.yml'], args: [] })
  })

  /** 首个未知参数开始应用参数区域，后续内容全部原样传递。 */
  it('ends the launcher flags at the first token it does not own', () => {
    // App flags, including its -h, and positionals reach the app verbatim.
    // 应用选项（包括 -h）和位置参数必须原样到达应用。
    expect(parse(['--profile', 'tui', '--resume', 'abc']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume', 'abc'] })
    expect(parse(['--profile', 'web', '-h']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['-h'] })
    expect(parse(['web', '--host', '127.0.0.1', '--port', '8080', '--no-open', '--future-web-flag']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--host', '127.0.0.1', '--port', '8080', '--no-open', '--future-web-flag'] })
    expect(parse(['--profile', 'headless', 'run', 'the', 'tests']))
      .toEqual({ mode: 'profile', profile: 'headless', patches: [], args: ['run', 'the', 'tests'] })
    // Launcher flags placed after that boundary belong to the app too.
    // 边界之后即使长得像启动器选项，也仍属于应用。
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--resume', 'b', '--patch', 'late.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml'], args: ['--resume', 'b', '--patch', 'late.yml'] })
  })

  /** plugin 子命令应原样转发 pnpm 动作、包名和未知选项。 */
  it('routes the plugin pnpm forwarder', () => {
    expect(parse(['plugin', '--profile', 'tui', 'add', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'remove', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['remove', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'why', '@deepseek-ai/cordis']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['why', '@deepseek-ai/cordis'] })
    // Unknown pnpm flags forward verbatim.
    // 启动器不解释 pnpm 的未知选项，直接原样转发。
    expect(parse(['plugin', '--profile', 'tui', 'add', '--save-dev', 'x']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', '--save-dev', 'x'] })
  })

  /** 根命令和 web 别名均应正确区分完整配置与默认配置导出。 */
  it('routes profile and web config dumps', () => {
    expect(parse(['--profile', 'web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['--profile', 'web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
    expect(parse(['--profile', 'tui', '--dump-config', '--patch', 'x.yml']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: ['x.yml'] })
    expect(parse(['web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
  })

  /** 缺少配置、已移除选项和互斥组合都必须以错误码退出。 */
  it('rejects missing profile, removed flags, and contradictory inputs', () => {
    expect(exitCode([])).toBe(1)
    expect(exitCode(['tui'])).toBe(1) // an app argument without --profile has no app to reach
    expect(exitCode(['--config', 'c.yml'])).toBe(1) // removed
    expect(exitCode(['-p', 'task'])).toBe(1) // removed
    expect(exitCode(['run', 'task'])).toBe(1) // app-owned task replaced the launcher subcommand
    expect(exitCode(['--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', '--patch='])).toBe(1)
    expect(exitCode(['--dump-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-default-config', '--patch', 'p.yml'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', 'task'])).toBe(1)
    expect(exitCode(['--bogus'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'web'])).toBe(1)
    expect(exitCode(['web', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['web', '--dump-default-config', '--patch', 'w.yml'])).toBe(1)
    expect(exitCode(['web', '--patch='])).toBe(1)
    // A dump never runs app command-line providers, so it cannot show what
    // those flags would decide; printing a tree that differs from the same
    // invocation's boot would mislead.
    // 配置导出不运行应用参数提供方，因此带应用参数的导出必须拒绝。
    expect(exitCode(['web', '--dump-config', '--port', '8080'])).toBe(1)
    expect(exitCode(['--profile', 'web', '--dump-config', '-h'])).toBe(1)
    expect(exitCode(['plugin', 'add', 'x'])).toBe(1) // --profile required
    expect(exitCode(['plugin', '--profile', 'tui'])).toBe(1) // nothing to forward
    expect(exitCode(['plugin', '--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', 'plugin', 'add', 'y'])).toBe(1)
  })

  /** 没有目标应用接收帮助参数时，启动器保留自身帮助、简写和版本处理。 */
  it('keeps its own help for an invocation with no app to hand it to', () => {
    expect(exitCode(['--help'])).toBe(0)
    expect(exitCode(['-h'])).toBe(0)
    expect(exitCode(['--version'])).toBe(0)
  })
})
