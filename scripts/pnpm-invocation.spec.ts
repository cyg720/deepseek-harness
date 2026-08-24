/**
 * 文件职责：验证仓库脚本在不同 npm_execpath 形式下选择正确的 pnpm 启动方式。
 * 技术维度：使用 Vitest 参数化测试覆盖 JavaScript 入口、原生可执行文件和缺失环境变量。
 * 产品维度：保证构建脚本在 Unix、Windows、空格路径和非 ASCII 路径中可靠启动 pnpm。
 * 逻辑维度：第一组经 Node 执行脚本入口，第二组直接执行二进制，第三组检查缺失入口时报错。
 * 关键边界：只根据入口扩展名分流；路径内容必须原样传递，不能经 shell 再解释。
 * 新手阅读建议：先看每组输入数组，再比较期望的 command 与 args，最后阅读 pnpm-invocation.ts 实现。
 */
import { describe, expect, it } from 'vitest'
import { pnpmInvocation } from './pnpm-invocation.ts'

// pnpmInvocation 的测试套件；回调无参数且无返回值，三组用例本身就是调用示例。
describe('pnpm invocation', () => {
  // JavaScript 入口样本；entrypoint 是任意大小写扩展名或特殊字符路径，期望由当前 Node 运行。
  it.each([
    '/tools/pnpm.js',
    '/tools/pnpm.cjs',
    '/tools/pnpm.mjs',
    '/tools/PNPM.CJS',
    '/tools/with spaces/工具/$pnpm;.mjs',
  ])('runs the JavaScript entrypoint %j through Node', (entrypoint) => {
    expect(pnpmInvocation(['run', 'build'], { npm_execpath: entrypoint })).toEqual({
      command: process.execPath,
      args: [entrypoint, 'run', 'build'],
    })
  })

  // 原生可执行入口样本；entrypoint 必须直接成为 command，不能添加 shell 转义或 Node 包装。
  it.each([
    '/tools/pnpm',
    '/tools/with spaces/$pnpm;',
    String.raw`C:\Program Files\工具\$pnpm;\pnpm.exe`,
  ])('runs the executable entrypoint %j directly', (entrypoint) => {
    expect(pnpmInvocation(['run', 'build'], { npm_execpath: entrypoint })).toEqual({
      command: entrypoint,
      args: ['run', 'build'],
    })
  })

  // 不可用入口样本；entrypoint 仅为 undefined 或空字符串，调用必须抛出明确错误。
  it.each([undefined, ''])('rejects an unavailable lifecycle entrypoint', (entrypoint) => {
    expect(() => pnpmInvocation([], { npm_execpath: entrypoint }))
      .toThrow('npm_execpath is unavailable; invoke the script through pnpm run')
  })
})
