/**
 * 文件职责：验证Codex Hook 桥的 config.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Fetch/RPC 信封、运行时模式校验、Node/Windows 宿主接口。
 * 产品维度：保证浏览器 API、Hook 或目录操作在各种状态下可靠且可诊断。
 * 逻辑维度：构造请求与宿主服务，调用端点并断言响应和清理。
 * 关键边界：网络与路径输入必须校验；原生对话框和宿主路径操作只允许受信调用。
 * 新手阅读建议：先读请求/响应夹具，再按 API 域、错误码和生命周期场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { parseCodexConfig, CODEX_EVENTS } from '@deepseek-ai/dsh-hooks-codex/src/config.ts'

describe('parseCodexConfig', () => {
  it('honors only the five bridge-supported Codex events, dropping the rest', () => {
    /** 中文说明：测试局部值 { config }，由紧邻初始化决定。 */
    const { config } = parseCodexConfig({
      PreToolUse: [{ hooks: [{ type: 'command', command: 'a.sh' }] }],
      SubagentStop: [{ hooks: [{ type: 'command', command: 'b.sh' }] }], // current Codex event, unsupported by this bridge
      Notification: [{ hooks: [{ type: 'command', command: 'c.sh' }] }], // unknown to current Codex
    })
    expect(Object.keys(config)).toEqual(['PreToolUse'])
    expect(CODEX_EVENTS).toContain('PreToolUse')
    expect(CODEX_EVENTS).not.toContain('SubagentStop' as never)
  })

  it('accepts both timeout and the timeoutSec alias, no substitution', () => {
    /** 中文说明：测试局部值 { config }，由紧邻初始化决定。 */
    const { config } = parseCodexConfig({
      Stop: [{ hooks: [{ type: 'command', command: '${NOT_SUBSTITUTED}/s.sh', timeout: 10 }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'u.sh', timeoutSec: 20 }] }],
    })
    // The parser performs no config-time substitution; shell expansion happens later.
    expect(config.Stop).toEqual([{ hooks: [{ command: '${NOT_SUBSTITUTED}/s.sh', timeoutSec: 10 }] }])
    expect(config.UserPromptSubmit).toEqual([{ hooks: [{ command: 'u.sh', timeoutSec: 20 }] }])
  })

  it('skips non-command and async:true hooks (recorded)', () => {
    /** 中文说明：测试局部值 { config, skipped }，由紧邻初始化决定。 */
    const { config, skipped } = parseCodexConfig({
      PreToolUse: [{ hooks: [
        { type: 'prompt' },
        { type: 'command', command: 'sync.sh' },
        { type: 'command', command: 'bg.sh', async: true },
      ] }],
    })
    expect(config.PreToolUse).toEqual([{ hooks: [{ command: 'sync.sh' }] }])
    expect(skipped).toEqual([{ event: 'PreToolUse', reason: 'unsupported "prompt" hook' }, { event: 'PreToolUse', reason: 'async hook' }])
  })

  it('parses the { hooks: … } wrapper and the bare map identically', () => {
    /** 中文说明：测试局部值 groups，由紧邻初始化决定。 */
    const groups = { Stop: [{ hooks: [{ type: 'command', command: 's.sh' }] }] }
    expect(parseCodexConfig(groups).config).toEqual(parseCodexConfig({ hooks: groups }).config)
  })

  it('drops malformed entries and a non-object top level without throwing', () => {
    expect(parseCodexConfig(null).config).toEqual({})
    expect(parseCodexConfig({ PreToolUse: 'no' }).config).toEqual({})
    expect(parseCodexConfig({ Stop: [7, { hooks: 'x' }, { hooks: [{ type: 'command', command: 9 }] }] }).config).toEqual({})
  })

  it('skips a non-object element inside a hooks array, keeping the valid sibling', () => {
    /** 中文说明：测试局部值 { config }，由紧邻初始化决定。 */
    const { config } = parseCodexConfig({ Stop: [{ hooks: [null, 7, { type: 'command', command: 's.sh' }] }] })
    expect(config.Stop).toEqual([{ hooks: [{ command: 's.sh' }] }])
  })

  it('treats a hook with no `type` field as a command (the default)', () => {
    /** 中文说明：测试局部值 { config }，由紧邻初始化决定。 */
    const { config } = parseCodexConfig({ Stop: [{ hooks: [{ command: 's.sh' }] }] })
    expect(config.Stop).toEqual([{ hooks: [{ command: 's.sh' }] }])
  })

  it('omits the matcher key for a match-all group', () => {
    /** 中文说明：测试局部值 { config }，由紧邻初始化决定。 */
    const { config } = parseCodexConfig({ Stop: [{ hooks: [{ type: 'command', command: 's.sh' }] }] })
    expect('matcher' in config.Stop![0]!).toBe(false)
  })

  it('keeps a matcher when present', () => {
    /** 中文说明：测试局部值 { config }，由紧邻初始化决定。 */
    const { config } = parseCodexConfig({ PreToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: 'b.sh' }] }] })
    expect(config.PreToolUse![0]!.matcher).toBe('^Bash$')
  })

  it('rejects an invalid regex matcher with its event name', () => {
    expect(() => parseCodexConfig({
      PreToolUse: [{ matcher: '[', hooks: [{ type: 'command', command: 's.sh' }] }],
    })).toThrow('invalid codex regex matcher "[" on event "PreToolUse"')
  })

  it('discards matcher fields on events without matcher subjects before validation', () => {
    /** 中文说明：测试局部值 { config }，由紧邻初始化决定。 */
    const { config } = parseCodexConfig({
      UserPromptSubmit: [{ matcher: '[', hooks: [{ type: 'command', command: 'prompt.sh' }] }],
      Stop: [{ matcher: '(', hooks: [{ type: 'command', command: 'stop.sh' }] }],
    })

    expect(config).toEqual({
      UserPromptSubmit: [{ hooks: [{ command: 'prompt.sh' }] }],
      Stop: [{ hooks: [{ command: 'stop.sh' }] }],
    })
  })
})
