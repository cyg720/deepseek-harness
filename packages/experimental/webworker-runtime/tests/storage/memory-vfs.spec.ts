/**
 * The identity, timestamp, link, mutation, and durability-sink guarantees
 * MemoryVfs owes its consumers, asserted directly rather than through the
 * `node:fs` bridge.
 *
 * `dsh-fs-local` builds a version token from `dev:ino:size:mtimeNs:ctimeNs` and
 * refuses a write whose token moved since it read. Two properties carry that:
 * `ino` identifies the entry at a path, and `mtimeMs` moves on every write. The
 * timestamp cases freeze the clock, because these writes are in memory and two
 * revisions routinely land in the same millisecond — a real-clock test passes
 * whether or not the strict increment exists.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 memory vfs spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryVfs } from '../../src/storage/memory.ts'
import type { VfsBigIntStats, VfsMutation, VfsMutationSink, VfsStats } from '../../src/storage/types.ts'

/**
 * 常量说明：identity 用于处理 identity 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 identity 相关流程；使用场景由所在模块及调用位置决定。
 * @param vfs （MemoryVfs）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns bigint；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 identity(vfs, path)，并按返回类型处理结果。
 */
const identity = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).ino

/**
 * 常量说明：linkCount 用于处理 linkCount 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 linkCount 相关流程；使用场景由所在模块及调用位置决定。
 * @param vfs （MemoryVfs）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns bigint；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 linkCount(vfs, path)，并按返回类型处理结果。
 */
const linkCount = (vfs: MemoryVfs, path: string): bigint =>
  (vfs.statSync(path, { bigint: true }) as VfsBigIntStats).nlink

/**
 * 常量说明：modified 用于处理 modified 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 modified 相关流程；使用场景由所在模块及调用位置决定。
 * @param vfs （MemoryVfs）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param path （string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 modified(vfs, path)，并按返回类型处理结果。
 */
const modified = (vfs: MemoryVfs, path: string): number => (vfs.statSync(path) as VfsStats).mtimeMs

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => { vi.restoreAllMocks() })

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('entry identity', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('distinguishes paths and holds each identity across repeated stats', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/one.txt', 'one')
    vfs.seed('/dsh/two.txt', 'two')
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const first = identity(vfs, '/dsh/one.txt')
    expect(identity(vfs, '/dsh/two.txt')).not.toBe(first)
    expect(identity(vfs, '/dsh/one.txt')).toBe(first)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('forgets the identities under a directory removed as a subtree', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/skills/git/SKILL.md', '# git\n')
    /**
     * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const before = identity(vfs, '/dsh/skills/git/SKILL.md')
    vfs.rmSync('/dsh/skills', { recursive: true })
    vfs.seed('/dsh/skills/git/SKILL.md', '# git rebuilt\n')
    expect(identity(vfs, '/dsh/skills/git/SKILL.md')).not.toBe(before)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('moves the source identity when a file replaces another path', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/from.txt', 'moved')
    vfs.seed('/dsh/to.txt', 'replaced')
    /**
     * 常量说明：source、destination 用于处理 source、destination 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const [source, destination] = [identity(vfs, '/dsh/from.txt'), identity(vfs, '/dsh/to.txt')]
    vfs.renameSync('/dsh/from.txt', '/dsh/to.txt')
    /**
     * 常量说明：renamed 用于处理 renamed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const renamed = identity(vfs, '/dsh/to.txt')
    expect(vfs.readFileSync('/dsh/to.txt', 'utf8')).toBe('moved')
    expect([renamed === source, renamed === destination]).toEqual([true, false])
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('modification time', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('hydrates explicit metadata without confusing timestamps with permission bits', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/restored', 'value', { mode: 0o600, mtimeMs: 1_600_000_000_000 })
    vfs.seedDirectory('/dsh/restored-directory', { mode: 0o700, mtimeMs: 1_600_000_000_001 })
    /**
     * 常量说明：stats 用于处理 stats 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stats = vfs.statSync('/dsh/restored') as VfsStats
    /**
     * 常量说明：directory 用于处理 directory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const directory = vfs.statSync('/dsh/restored-directory') as VfsStats
    expect([stats.mode & 0o777, stats.mtimeMs]).toEqual([0o600, 1_600_000_000_000])
    expect([directory.mode & 0o777, directory.mtimeMs]).toEqual([0o700, 1_600_000_000_001])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('advances on every write even while the clock stands still', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/log.jsonl', 'first\n')
    /**
     * 常量说明：seeded 用于处理 seeded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const seeded = modified(vfs, '/dsh/log.jsonl')
    vfs.writeFileSync('/dsh/log.jsonl', 'second\n')
    /**
     * 常量说明：written 用于处理 written 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const written = modified(vfs, '/dsh/log.jsonl')
    vfs.appendFileSync('/dsh/log.jsonl', 'third\n')
    /**
     * 常量说明：appended 用于处理 appended 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const appended = modified(vfs, '/dsh/log.jsonl')
    vfs.truncateSync('/dsh/log.jsonl', 6)
    /**
     * 常量说明：truncated 用于处理 truncated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const truncated = modified(vfs, '/dsh/log.jsonl')
    expect([written > seeded, appended > written, truncated > appended]).toEqual([true, true, true])
    // One millisecond per revision: the increment is the minimum that separates
    // two tokens, not a coarser bump that would skew a real timestamp.
    expect(truncated - seeded).toBe(3)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('takes the clock once the clock has passed the entry', () => {
    /**
     * 常量说明：clock 用于处理 clock 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/log.jsonl', 'first\n')
    clock.mockReturnValue(1_700_000_005_000)
    vfs.writeFileSync('/dsh/log.jsonl', 'second\n')
    expect(modified(vfs, '/dsh/log.jsonl')).toBe(1_700_000_005_000)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('extends truncation with zero bytes', async () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/file', new Uint8Array([1, 2]))
    vfs.truncateSync('/dsh/file', 5)
    expect([...vfs.readFileSync('/dsh/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0])
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = vfs.open('/dsh/file', 'r+')
    await handle.truncate(7)
    expect([...vfs.readFileSync('/dsh/file') as Uint8Array]).toEqual([1, 2, 0, 0, 0, 0, 0])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('advances a directory only when its immediate entry set changes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/dsh/workspace')
    /**
     * 常量说明：empty 用于处理 empty 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const empty = modified(vfs, '/dsh/workspace')
    vfs.writeFileSync('/dsh/workspace/file.txt', 'one')
    /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const created = modified(vfs, '/dsh/workspace')
    vfs.writeFileSync('/dsh/workspace/file.txt', 'two')
    /**
     * 常量说明：rewritten 用于处理 rewritten 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const rewritten = modified(vfs, '/dsh/workspace')
    vfs.rmSync('/dsh/workspace/file.txt')
    /**
     * 常量说明：removed 用于处理 removed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const removed = modified(vfs, '/dsh/workspace')
    expect([created > empty, rewritten === created, removed > rewritten]).toEqual([true, true, true])
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('mutation publication', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('publishes only committed runtime changes and keeps image seeding silent', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    /**
     * 常量说明：mutations 用于处理 mutations 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mutations: VfsMutation[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.seed('/dsh/seeded.txt', 'seeded')
    expect(mutations).toEqual([])
    vfs.writeFileSync('/dsh/seeded.txt', 'changed')
    vfs.mkdirSync('/dsh/created')
    vfs.chmodSync('/dsh/created', 0o700)
    vfs.renameSync('/dsh/seeded.txt', '/dsh/renamed.txt')
    vfs.rmSync('/dsh/created', { recursive: true })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    expect(mutations.map(mutation => ({
      kind: mutation.kind,
      path: mutation.path,
      ...mutation.kind === 'write' ? { entryChanged: mutation.entryChanged } : {},
      ...mutation.kind === 'chmod' ? { mode: mutation.mode } : {},
    }))).toEqual([
      { kind: 'write', path: '/dsh/seeded.txt', entryChanged: false },
      { kind: 'mkdir', path: '/dsh/created' },
      { kind: 'chmod', path: '/dsh/created', mode: 0o700 },
      { kind: 'remove', path: '/dsh/seeded.txt' },
      { kind: 'write', path: '/dsh/renamed.txt', entryChanged: true },
      { kind: 'remove', path: '/dsh/created' },
    ])
    /**
     * 常量说明：renamed 用于处理 renamed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const renamed = mutations[4]
    expect(renamed?.kind === 'write' && new TextDecoder().decode(renamed.bytes)).toBe('changed')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { vfs.writeFileSync('/missing/file', 'no') }).toThrow(/ENOENT/)
    expect(mutations).toHaveLength(6)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('contains a faulty observer and lets disposal stop later notifications', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/dsh')
    /**
     * 常量说明：reported 用于处理 reported 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const first = vfs.subscribe(() => { throw new Error('observer failed') })
    /**
     * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const seen: string[] = []
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    const second = vfs.subscribe((mutation) => { seen.push(mutation.path) })
    vfs.writeFileSync('/dsh/one', '1')
    first()
    second()
    vfs.writeFileSync('/dsh/two', '2')
    expect(seen).toEqual(['/dsh/one'])
    expect(reported).toHaveBeenCalledOnce()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('feeds the same complete mutations to a durable sink and live subscribers', async () => {
    /**
     * 常量说明：recorded 用于处理 recorded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const recorded: VfsMutation[] = []
    /**
     * 变量说明：flushes 用于处理 flushes 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let flushes = 0
    /**
     * 常量说明：sink 用于处理 sink 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const sink: VfsMutationSink = {
      record: (mutation) => { recorded.push(mutation) },
      flush: async () => { flushes += 1 },
    }
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs({ sink })
    vfs.seedDirectory('/dsh')
    /**
     * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const observed: VfsMutation[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    vfs.subscribe((mutation) => { observed.push(mutation) })
    vfs.writeFileSync('/dsh/log', 'a')
    vfs.appendFileSync('/dsh/log', 'bc')
    await vfs.flush()
    expect(observed).toEqual(recorded)
    expect(observed[0]).toBe(recorded[0])
    expect(recorded[0]).toMatchObject({ kind: 'write', path: '/dsh/log', mode: 0o644, entryChanged: true })
    expect(recorded[1]).toMatchObject({ kind: 'write', path: '/dsh/log', mode: 0o644, entryChanged: false, appendedFrom: 1 })
    expect(recorded[1]?.kind === 'write' && new TextDecoder().decode(recorded[1].bytes)).toBe('abc')
    expect(flushes).toBe(1)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('publishes descriptor writes at the file identity current path', () => {
    /**
     * 常量说明：mutations 用于处理 mutations 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mutations: VfsMutation[] = []
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/source', 'old')
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor = vfs.openFileSync('/dsh/source', 'r+')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    vfs.subscribe((mutation) => { mutations.push(mutation) })
    vfs.renameSync('/dsh/source', '/dsh/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('new'))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    expect(mutations.map(mutation => mutation.path)).toEqual(['/dsh/destination'])
    expect(vfs.readFileSync('/dsh/destination', 'utf8')).toBe('new')
    vfs.unlinkSync('/dsh/destination')
    mutations.length = 0
    descriptor.write(0, new TextEncoder().encode('detached'))
    expect(mutations).toEqual([])
    expect(new TextDecoder().decode(descriptor.read(0, descriptor.stat().size))).toBe('detached')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('decomposes a directory rename into replayable destination state', () => {
    /**
     * 常量说明：recorded 用于处理 recorded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const recorded: VfsMutation[] = []
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const vfs = new MemoryVfs({
      sink: { record: (mutation) => { recorded.push(mutation) }, flush: () => Promise.resolve() },
    })
    vfs.seedDirectory('/dsh/staging/nested', { mode: 0o700 })
    vfs.seed('/dsh/staging/nested/file', 'value', { mode: 0o600 })
    vfs.renameSync('/dsh/staging', '/dsh/published')

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    expect(recorded.map(mutation => [mutation.kind, mutation.path])).toEqual([
      ['remove', '/dsh/staging'],
      ['mkdir', '/dsh/published'],
      ['mkdir', '/dsh/published/nested'],
      ['write', '/dsh/published/nested/file'],
    ])
    expect(recorded[3]).toMatchObject({ kind: 'write', mode: 0o600, entryChanged: true })
    expect(recorded[3]?.kind === 'write' && new TextDecoder().decode(recorded[3].bytes)).toBe('value')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('directory rename', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects file, non-empty directory, and missing-parent destinations before mutation', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/source/nested/file', 'source')
    vfs.seed('/dsh/file', 'destination')
    vfs.seed('/dsh/non-empty/child', 'destination')
    /**
     * 常量说明：mutations 用于处理 mutations 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mutations: VfsMutation[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { vfs.renameSync('/dsh/source', '/dsh/file') })
      .toThrow(expect.objectContaining({ code: 'ENOTDIR' }))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { vfs.renameSync('/dsh/source', '/dsh/non-empty') })
      .toThrow(expect.objectContaining({ code: 'ENOTEMPTY' }))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { vfs.renameSync('/dsh/source', '/missing/destination') })
      .toThrow(expect.objectContaining({ code: 'ENOENT' }))

    expect(vfs.readFileSync('/dsh/source/nested/file', 'utf8')).toBe('source')
    expect(vfs.readFileSync('/dsh/file', 'utf8')).toBe('destination')
    expect(vfs.readFileSync('/dsh/non-empty/child', 'utf8')).toBe('destination')
    expect(mutations).toEqual([])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('replaces an empty directory with the source subtree', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seedDirectory('/dsh/source/nested', { mode: 0o700 })
    vfs.seed('/dsh/source/nested/file', 'source')
    vfs.seedDirectory('/dsh/destination', { mode: 0o711 })

    vfs.renameSync('/dsh/source', '/dsh/destination')

    expect(vfs.existsSync('/dsh/source')).toBe(false)
    expect(vfs.readFileSync('/dsh/destination/nested/file', 'utf8')).toBe('source')
    expect((vfs.statSync('/dsh/destination') as VfsStats).mode & 0o777).toBe(0o755)
    expect((vfs.statSync('/dsh/destination/nested') as VfsStats).mode & 0o777).toBe(0o700)
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('hard links', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('shares identity, bytes, and mode until one name is removed', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/session.jsonl', 'committed\n')
    vfs.linkSync('/dsh/session.jsonl', '/dsh/session-latest.jsonl')
    vfs.linkSync('/dsh/session-latest.jsonl', '/dsh/session-archive.jsonl')
    expect(identity(vfs, '/dsh/session-latest.jsonl')).toBe(identity(vfs, '/dsh/session.jsonl'))
    expect(linkCount(vfs, '/dsh/session.jsonl')).toBe(3n)
    expect(vfs.readFileSync('/dsh/session-latest.jsonl', 'utf8')).toBe('committed\n')
    /**
     * 常量说明：changedPaths 用于处理 changedPaths 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const changedPaths: string[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    vfs.subscribe((mutation) => { changedPaths.push(mutation.path) })
    vfs.appendFileSync('/dsh/session.jsonl', 'appended\n')
    expect(changedPaths).toEqual([
      '/dsh/session.jsonl',
      '/dsh/session-latest.jsonl',
      '/dsh/session-archive.jsonl',
    ])
    expect(vfs.readFileSync('/dsh/session.jsonl', 'utf8')).toBe('committed\nappended\n')
    expect(vfs.readFileSync('/dsh/session-latest.jsonl', 'utf8')).toBe('committed\nappended\n')
    vfs.chmodSync('/dsh/session-latest.jsonl', 0o600)
    expect((vfs.statSync('/dsh/session.jsonl') as VfsStats).mode & 0o777).toBe(0o600)
    vfs.unlinkSync('/dsh/session-latest.jsonl')
    expect(linkCount(vfs, '/dsh/session.jsonl')).toBe(2n)
    vfs.unlinkSync('/dsh/session-archive.jsonl')
    expect(linkCount(vfs, '/dsh/session.jsonl')).toBe(1n)
    expect(vfs.readFileSync('/dsh/session.jsonl', 'utf8')).toBe('committed\nappended\n')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('treats rename between names of the same node as a no-op', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/source', 'value')
    vfs.linkSync('/dsh/source', '/dsh/alias')
    /**
     * 常量说明：mutations 用于处理 mutations 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mutations: VfsMutation[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    vfs.renameSync('/dsh/source', '/dsh/alias')

    expect(vfs.readFileSync('/dsh/source', 'utf8')).toBe('value')
    expect(vfs.readFileSync('/dsh/alias', 'utf8')).toBe('value')
    expect(linkCount(vfs, '/dsh/source')).toBe(2n)
    expect(mutations).toEqual([])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('retargets linked names through file replacement and directory moves', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/replacement', 'replacement')
    vfs.seed('/dsh/target', 'old')
    vfs.linkSync('/dsh/target', '/dsh/target-alias')
    /**
     * 常量说明：replaced 用于处理 replaced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const replaced = vfs.openFileSync('/dsh/target', 'r+')
    vfs.renameSync('/dsh/replacement', '/dsh/target')
    /**
     * 常量说明：mutations 用于处理 mutations 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const mutations: VfsMutation[] = []
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    vfs.subscribe((mutation) => { mutations.push(mutation) })

    replaced.write(0, new TextEncoder().encode('changed'))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    expect(mutations.map(mutation => mutation.path)).toEqual(['/dsh/target-alias'])
    expect(vfs.readFileSync('/dsh/target', 'utf8')).toBe('replacement')
    expect(vfs.readFileSync('/dsh/target-alias', 'utf8')).toBe('changed')
    expect(linkCount(vfs, '/dsh/target-alias')).toBe(1n)

    vfs.seed('/dsh/tree/file', 'tree')
    vfs.linkSync('/dsh/tree/file', '/dsh/outside')
    /**
     * 常量说明：moved 用于处理 moved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const moved = vfs.openFileSync('/dsh/tree/file', 'r+')
    vfs.renameSync('/dsh/tree', '/dsh/moved')
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('moved'))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    expect(mutations.map(mutation => mutation.path)).toEqual(['/dsh/outside', '/dsh/moved/file'])
    expect(linkCount(vfs, '/dsh/moved/file')).toBe(2n)

    vfs.rmSync('/dsh/moved', { recursive: true })
    mutations.length = 0
    moved.write(0, new TextEncoder().encode('kept!'))
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：mutation（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(mutation)，并按返回类型处理结果。
     */
    expect(mutations.map(mutation => mutation.path)).toEqual(['/dsh/outside'])
    expect(vfs.readFileSync('/dsh/outside', 'utf8')).toBe('kept!')
    expect(linkCount(vfs, '/dsh/outside')).toBe(1n)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects renaming a file over an existing directory', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = new MemoryVfs()
    vfs.seed('/dsh/file', 'value')
    vfs.seedDirectory('/dsh/directory')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => { vfs.renameSync('/dsh/file', '/dsh/directory') }).toThrow(expect.objectContaining({ code: 'EISDIR' }))
    expect(vfs.readFileSync('/dsh/file', 'utf8')).toBe('value')
    expect(vfs.statSync('/dsh/directory').isDirectory()).toBe(true)
  })
})
