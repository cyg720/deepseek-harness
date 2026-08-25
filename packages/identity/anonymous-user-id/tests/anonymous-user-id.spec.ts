/**
 * 文件职责：验证匿名身份的 anonymous-user-id.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证匿名身份在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ANONYMOUS_USER_ID_FILE_NAME,
  getOrCreateAnonymousUserId,
} from '../src/index.ts'

/** 中文说明：测试局部值 dirs，由紧邻初始化决定。 */
const dirs: string[] = []

/** 中文说明：函数 tempHome 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function tempHome(): string {
  /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
  const dir = mkdtempSync(join(tmpdir(), 'dsh-userid-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  /** 中文说明：测试局部值 dir，由紧邻初始化决定。 */
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 中文说明：测试局部值 UUID，由紧邻初始化决定。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('getOrCreateAnonymousUserId', () => {
  it('creates, persists, and returns a bare UUID line on first use', () => {
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = tempHome()
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })
    expect(id).toMatch(UUID)
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`${id}\n`)
  })

  it('creates the home directory when missing', () => {
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = join(tempHome(), 'nested', 'home')
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`${id}\n`)
  })

  it('returns the persisted id on subsequent calls, tolerating surrounding whitespace', () => {
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = tempHome()
    /** 中文说明：测试局部值 existing，由紧邻初始化决定。 */
    const existing = '01234567-89ab-4cde-8f01-23456789abcd'
    writeFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), `  ${existing}\n\n`, 'utf8')
    expect(getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })).toBe(existing)
  })

  it('overwrites a corrupt file with a fresh id', () => {
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = tempHome()
    writeFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'not-a-uuid\n', 'utf8')
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })
    expect(id).toMatch(UUID)
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`${id}\n`)
  })

  it('adopts a concurrent winner: exclusive create loses to an id written after the initial read', () => {
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = tempHome()
    /** 中文说明：测试局部值 winner，由紧邻初始化决定。 */
    const winner = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    /** 中文说明：测试局部值 file，由紧邻初始化决定。 */
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    // The generator hook runs between the initial read (absent) and the wx
    // write, so planting the winner here simulates the concurrent first launch.
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = getOrCreateAnonymousUserId({
      env: { DSH_HOME: home },
      randomUUID: () => {
        writeFileSync(file, `${winner}\n`, 'utf8')
        return 'ffffffff-0000-4000-8000-000000000000'
      },
    })
    expect(id).toBe(winner)
  })

  it('returns a usable id when the home cannot contain files, without persisting', () => {
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = tempHome()
    /** 中文说明：测试局部值 blocked，由紧邻初始化决定。 */
    const blocked = join(home, 'blocked')
    writeFileSync(blocked, 'occupied\n')
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = getOrCreateAnonymousUserId({ env: { DSH_HOME: blocked } })
    expect(id).toMatch(UUID)
    expect(existsSync(join(blocked, ANONYMOUS_USER_ID_FILE_NAME))).toBe(false)
  })

  it('memoizes per resolved home for the process lifetime: one read, deletion-proof', () => {
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = tempHome()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })
    rmSync(join(home, ANONYMOUS_USER_ID_FILE_NAME))
    expect(getOrCreateAnonymousUserId({ env: { DSH_HOME: home } })).toBe(first)
  })

  it('keeps distinct homes on distinct ids', () => {
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = getOrCreateAnonymousUserId({ env: { DSH_HOME: tempHome() } })
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = getOrCreateAnonymousUserId({ env: { DSH_HOME: tempHome() } })
    expect(a).not.toBe(b)
  })

  it('reads process.env by default', () => {
    /** 中文说明：测试局部值 home，由紧邻初始化决定。 */
    const home = tempHome()
    /** 中文说明：测试局部值 previous，由紧邻初始化决定。 */
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
      const id = getOrCreateAnonymousUserId()
      expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(`${id}\n`)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
