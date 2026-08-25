/**
 * quoteArg unit tests plus a round-trip through the REAL CommandLineToArgvW
 * parser (shell32.dll, shellapi.h line ~867:
 * `LPWSTR *CommandLineToArgvW(LPCWSTR lpCmdLine, int *pNumArgs)`) on win32.
 *
 * CommandLineToArgvW applies the documented backslash rule (2n backslashes
 * before a quote produce n backslashes and toggle quoting; 2n+1 produce n
 * backslashes and a literal quote) to every token EXCEPT the first — the
 * first token is parsed with backslashes literal and quotes toggling
 * (verified empirically on this machine, Windows 11 build 26200). The
 * round-trip therefore prepends a plain program token, exactly like
 * buildCommandLine's real callers do, so the arguments under test land on
 * the rule-applying tokens.
 *
 * Reading argv from CommandLineToArgvW: koffi cannot decode the returned
 * LPWSTR* contents directly (the pointed-to strings are not koffi-registered
 * references), so each string is copied with lstrcpynW (winbase.h line
 * ~1500) into a Node Buffer and read as UTF-16LE; lengths come from
 * lstrlenW (winbase.h line ~1506); the argv block is freed with LocalFree
 * (winbase.h line ~1127) — CommandLineToArgvW's documented contract.
 */
/*
 * 文件职责：验证 quote.spec.ts 覆盖的沙箱安全与权限隔离行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用沙箱安全与权限隔离时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */

import { describe, expect, it } from 'vitest'

import { buildCommandLine, quoteArg } from '../src/spawn.ts'

/** 中文说明：变量 isWin32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const isWin32 = process.platform === 'win32'

/**
 * Table cases: input argv entry → the exact command-line fragment quoteArg
 * must produce. Trailing-backslash inputs are the regression: the closing
 * quote must be preceded by DOUBLED backslashes, or the parser reads them as
 * escaping the closing quote.
 */
/* 中文说明：变量 cases 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const cases: Array<[input: string, quoted: string]> = [
  ['', '""'],
  ['a', 'a'],
  ['a b', '"a b"'],
  ['a"b', '"a\\"b"'],
  ['a\\b', 'a\\b'],
  ['a b\\', '"a b\\\\"'],
  ['a b\\\\', '"a b\\\\\\\\"'],
  ['a b\\\\\\', '"a b\\\\\\\\\\\\"'],
  ['a\\\\"b', '"a\\\\\\\\\\"b"'],
]

describe('quoteArg', () => {
  it.each(cases)('quotes %j as %j', (input, quoted) => {
    expect(quoteArg(input)).toBe(quoted)
  })
})

describe.skipIf(!isWin32)('CommandLineToArgvW round-trip', () => {
  it('parses quoteArg+join back to the exact original argv', async () => {
    const { default: koffi } = await import('koffi')
    /** 中文说明：常量 PVOID 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
    const PVOID = koffi.pointer('void')
    /** 中文说明：变量 shell32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shell32 = koffi.load('shell32.dll')
    /** 中文说明：变量 kernel32 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const kernel32 = koffi.load('kernel32.dll')
    /** 中文说明：变量 commandLineToArgvW 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const commandLineToArgvW = shell32.func('__stdcall', 'CommandLineToArgvW', PVOID, ['str16', koffi.pointer('int')])
    /** 中文说明：变量 lstrcpynW 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lstrcpynW = kernel32.func('__stdcall', 'lstrcpynW', PVOID, [PVOID, PVOID, 'int'])
    /** 中文说明：变量 lstrlenW 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lstrlenW = kernel32.func('__stdcall', 'lstrlenW', 'int', [PVOID])
    /** 中文说明：变量 localFree 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const localFree = kernel32.func('__stdcall', 'LocalFree', PVOID, [PVOID])

    /** 中文说明：函数值 parse 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const parse = (commandLine: string): string[] => {
      /** 中文说明：变量 countSlot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const countSlot = koffi.alloc('int', 1) as unknown
      /** 中文说明：变量 argvBlock 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const argvBlock = commandLineToArgvW(commandLine, countSlot) as unknown
      try {
        if (argvBlock === null) throw new Error('CommandLineToArgvW returned NULL')
        /** 中文说明：变量 count 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const count = koffi.decode(countSlot, 0, 'int') as number
        /** 中文说明：变量 table 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const table = Buffer.from(koffi.view(argvBlock, count * 8))
        /** 中文说明：变量 parsed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const parsed: string[] = []
        /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
        for (let index = 0; index < count; index++) {
          /** 中文说明：变量 stringAddress 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const stringAddress = table.readBigUInt64LE(index * 8)
          /** 中文说明：变量 copied 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const copied = Buffer.alloc(2048)
          lstrcpynW(copied, stringAddress, copied.length / 2)
          /** 中文说明：变量 length 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const length = lstrlenW(copied) as number
          parsed.push(copied.subarray(0, length * 2).toString('utf16le'))
        }
        return parsed
      } finally {
        localFree(argvBlock)
      }
    }

    /** 中文说明：变量 argv 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const argv = ['', 'a', 'a b', 'a"b', 'a\\b', 'a b\\', 'a b\\\\', 'a b\\\\\\', 'a\\\\"b']
    expect(parse(buildCommandLine('prog.exe', argv))).toEqual(['prog.exe', ...argv])
  })
})
