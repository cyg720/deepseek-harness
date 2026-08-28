/**
 * 文件职责：验证 test-support/session-snapshot 中 partial landlock sandbox
 * 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { join } from 'node:path'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'

/**
 * 常量说明：NOTICE 用于处理 NOTICE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const NOTICE = 'landlock-run: partial enforcement (older Landlock ABI)'
/**
 * 常量说明：MISSING_RUNNER_ENV 用于处理 MISSING_RUNNER_ENV 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const MISSING_RUNNER_ENV = 'DSH_SNAPSHOT_MISSING_SANDBOX_RUNNER'

/**
 * Snapshot-only provider for deterministic runner classification. Its default
 * launch reproduces older-ABI Landlock; an explicit scenario flag selects a
 * missing executable under the valid workspace cwd. Keep the Landlock tuple
 * aligned with `RUNNER_FAILURE_RULES` in `packages/sandbox/sandbox-local/src/index.ts`.
 * @remarks 中文说明：类说明：PartialLandlockSandboxProvider 用于集中封装 处理
 * PartialLandlockSandboxProvider 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 test-support/session-snapshot
 * 在对应插件或业务生命周期内创建和调用。
 */
export default class PartialLandlockSandboxProvider extends SandboxProvider {
  /**
   * 功能说明：处理 confine 相关流程；使用场景由所在模块及调用位置决定。
   * @param argv （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param policy （SandboxPolicy）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ConfinedArgv；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 confine(argv, policy)，并按返回类型处理结果。
   */
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    if (process.env[MISSING_RUNNER_ENV] === '1') {
      return {
        argv: [join(policy.workspaceRoot, '.dsh-missing-sandbox-runner'), ...argv],
        enforcement: 'full',
        denialSignatures: ['permission denied'],
        runnerFailureRules: [{ fatalSignatures: ['snapshot-runner: '] }],
      }
    }
    return {
      argv: [
        'bash',
        '-c',
        `printf '%s\\n' '${NOTICE}' >&2; exec "$@"`,
        'partial-landlock-run',
        ...argv,
      ],
      enforcement: 'partial',
      denialSignatures: ['permission denied'],
      runnerFailureRules: [{
        allowedExitCodes: [125],
        fatalSignatures: ['landlock-run: '],
        informationalLines: [NOTICE],
      }],
    }
  }
}
