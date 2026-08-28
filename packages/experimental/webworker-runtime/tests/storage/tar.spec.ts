/**
 * The bare-tar image codec: byte-faithful roundtrip through packTar/parseTar
 * and the VFS mount the worker performs on that archive.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 tar spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import { packTar, parseTar } from '../../src/storage/tar.ts'
import { loadVfsImage, loadVfsOverlay } from '../../src/storage/memory.ts'

/**
 * 常量说明：encoder 用于处理 encoder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const encoder = new TextEncoder()

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('tar codec', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('roundtrips files and empty directories byte-faithfully', () => {
    /**
     * 常量说明：payload 用于处理 payload 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const payload = new Uint8Array([0, 1, 2, 253, 254, 255])
    /**
     * 常量说明：files 用于处理 files 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const files = {
      'config/cordis.yml': encoder.encode('- id: subject\n'),
      'node_modules/pkg/lib/index.js': payload,
      'home/': new Uint8Array(0),
    }
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entries = parseTar(packTar(files))
    /**
     * 常量说明：byName 用于处理 byName 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
     */
    const byName = new Map(entries.map(entry => [entry.name, entry]))
    expect([...byName.keys()].sort()).toEqual(Object.keys(files).sort())
    expect([...byName.get('node_modules/pkg/lib/index.js')!.bytes]).toEqual([...payload])
    expect(byName.get('home/')!.bytes.byteLength).toBe(0)
    // The header mode field carries the packed permission bits: normal
    // 644/755, which the VFS mount reports back through stat.
    expect(byName.get('node_modules/pkg/lib/index.js')!.mode).toBe(0o644)
    expect(byName.get('home/')!.mode).toBe(0o755)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('mounts as a VFS with directories synthesized along file paths', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = loadVfsImage(packTar({
      'config/cordis.yml': encoder.encode('- id: subject\n'),
      'workspace/': new Uint8Array(0),
    }), '/dsh')
    expect(vfs.existsSync('/dsh/config/cordis.yml')).toBe(true)
    expect(vfs.readFileSync('/dsh/config/cordis.yml', 'utf8')).toBe('- id: subject\n')
    expect(vfs.existsSync('/dsh/config')).toBe(true)
    expect(vfs.existsSync('/dsh/workspace')).toBe(true)
    expect(vfs.existsSync('/dsh/absent')).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('applies ordered data overlays without exposing runtime paths', () => {
    /**
     * 常量说明：vfs 用于处理 vfs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const vfs = loadVfsImage(packTar({
      'config/cordis.yml': encoder.encode('- id: subject\n'),
      'workspace/status.txt': encoder.encode('base'),
    }), '/dsh')
    loadVfsOverlay(packTar({
      'workspace/status.txt': encoder.encode('fixture'),
      'home/sessions/example/session.jsonl': encoder.encode('{}\n'),
    }), '/dsh', vfs)
    expect(vfs.readFileSync('/dsh/workspace/status.txt', 'utf8')).toBe('fixture')
    expect(vfs.readFileSync('/dsh/home/sessions/example/session.jsonl', 'utf8')).toBe('{}\n')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => loadVfsOverlay(packTar({
      'config/cordis.yml': encoder.encode('replaced'),
    }), '/dsh', vfs)).toThrow(/overlay entry must stay under home\/ or workspace/)
    expect(vfs.readFileSync('/dsh/config/cordis.yml', 'utf8')).toBe('- id: subject\n')
  })
})
