/**
 * 文件职责：验证 launch-environment.spec.ts 覆盖的通用运行时工具行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的通用运行时工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY, launchEnvironmentOf,
} from '../src/index.ts'

/** 中文说明：变量 layered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const layered = createLaunchEnvironmentSnapshot([
  { source: 'process', values: { SHARED: 'from-process', ONLY_PROCESS: 'p' } },
  { source: 'project-env', path: '/work/.env', values: { SHARED: 'from-project', ONLY_PROJECT: 'j' } },
  { source: 'user-env', path: '/home/.dsh/.env', values: { SHARED: 'from-user', ONLY_USER: 'u' } },
])

describe('createLaunchEnvironmentSnapshot', () => {
  it('resolves across every layer, most trusted first, and reports the winning source', () => {
    expect(layered.get('SHARED')).toEqual({ value: 'from-process', source: 'process' })
    expect(layered.get('ONLY_PROJECT')).toEqual({ value: 'j', source: 'project-env', path: '/work/.env' })
    expect(layered.get('ONLY_USER')).toEqual({ value: 'u', source: 'user-env', path: '/home/.dsh/.env' })
    expect(layered.get('ABSENT')).toBeUndefined()
  })

  it('filters layers without changing their trust order', () => {
    // The point of getFrom: a routing field that must never come from a
    // project directory cannot be reached by reordering, only by listing it.
    expect(layered.getFrom('ONLY_PROJECT', ['process', 'user-env'])).toBeUndefined()
    expect(layered.getFrom('SHARED', ['user-env', 'process']))
      .toEqual({ value: 'from-process', source: 'process' })
    expect(layered.getFrom('SHARED', [])).toBeUndefined()
  })

  it('copies each layer, so a later mutation of the source object cannot change it', () => {
    /** 中文说明：变量 values 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const values: Record<string, string> = { KEY: 'first' }
    /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshot = createLaunchEnvironmentSnapshot([{ source: 'process', values }])
    values.KEY = 'second'
    values.LATE = 'added'
    expect(snapshot.get('KEY')).toEqual({ value: 'first', source: 'process' })
    expect(snapshot.get('LATE')).toBeUndefined()
  })

  it('keeps an empty value as a present value, for its owner to judge', () => {
    /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const snapshot = createLaunchEnvironmentSnapshot([{ source: 'process', values: { EMPTY: '' } }])
    expect(snapshot.get('EMPTY')).toEqual({ value: '', source: 'process' })
  })

  it('orders lookups canonically regardless of construction order', () => {
    /** 中文说明：变量 reversed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reversed = createLaunchEnvironmentSnapshot([
      { source: 'user-env', path: '/u', values: { K: 'u' } },
      { source: 'process', values: { K: 'p' } },
    ])
    expect(reversed.get('K')).toEqual({ value: 'p', source: 'process' })
  })
})

describe('launchEnvironmentOf', () => {
  it('returns the launcher snapshot when the product CLI provided one', () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, layered)
    expect(launchEnvironmentOf(ctx)).toBe(layered)
  })

  it('falls back to the inherited environment as the only layer', () => {
    vi.stubEnv('DSH_ENV_SPEC_FALLBACK', 'ambient')
    try {
      /** 中文说明：变量 snapshot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const snapshot = launchEnvironmentOf(new Context())
      expect(snapshot.get('DSH_ENV_SPEC_FALLBACK')).toEqual({ value: 'ambient', source: 'process' })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
