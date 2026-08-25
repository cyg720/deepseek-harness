/**
 * 文件职责：验证 ci-workflow.spec.ts 覆盖的仓库构建、校验或维护脚本职责。
 * 技术维度：使用 TypeScript、JavaScript、Vitest、Node.js 文件系统或构建工具。
 * 产品维度：通过仓库构建、校验或维护脚本保障项目开发、发布和 Agent 工作区行为一致。
 * 逻辑维度：解析参数和文件，执行检查或转换，再输出结果并处理错误。
 * 关键边界：脚本可能修改构建产物；路径和子进程输出不可信；失败必须以非零状态显式报告。
 * 新手阅读建议：先看命令入口和参数，再读文件遍历或转换，最后关注错误码和平台差异。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

/** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const root = resolve(import.meta.dirname, '..')
/** 中文说明：变量 runnerPrivatePnpmDestination 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const runnerPrivatePnpmDestination = '${{ runner.temp }}/setup-pnpm'
/** 中文说明：变量 nativeWindowsPnpmDestination 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const nativeWindowsPnpmDestination = '${{ runner.temp }}/setup-pnpm-js'

describe('CI workflow', () => {
  it('isolates every pnpm action setup destination per runner', () => {
    /** 中文说明：变量 files 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const files = ['.github/workflows/ci.yml', '.github/workflows/ci-master.yml']
    /** 中文说明：变量 setups 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const setups: Array<{ jobName: string; step: unknown }> = []
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const file of files) {
      /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const workflow: unknown = yaml.load(readFileSync(resolve(root, file), 'utf8'))
      if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (!isRecord(job) || !Array.isArray(job.steps)) continue
        /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
        for (const step of job.steps) {
          if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
          setups.push({ jobName, step })
        }
      }
    }

    expect(setups.length).toBeGreaterThan(0)
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const { jobName, step } of setups) {
      expect(step, `${jobName} must not share pnpm/action-setup's default destination`).toMatchObject({
        with: {
          dest: jobName === 'windows-native'
            ? nativeWindowsPnpmDestination
            : runnerPrivatePnpmDestination,
        },
      })
      if (jobName === 'windows-native') expect(step).not.toMatchObject({ with: { standalone: true } })
    }
  })

  it('keeps a required Wine Windows job, a non-blocking native Windows job with failover, and a master-only standby', () => {
    /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    /** 中文说明：变量 masterWorkflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const masterWorkflow = loadWorkflow('.github/workflows/ci-master.yml')
    if (!isRecord(workflow.jobs)
      || !isRecord(workflow.jobs.windows)
      || !isRecord(workflow.jobs['windows-native'])
      || !isRecord(workflow.jobs['node-24'])
      || !isRecord(workflow.jobs['node-24-coverage'])
      || !isRecord(workflow.jobs['node-24-consumers'])
      || !isRecord(workflow.jobs['all-checks-passed'])
      || !isRecord(masterWorkflow.jobs)
      || !isRecord(masterWorkflow.jobs['wine-apt-cache'])
      || !isRecord(masterWorkflow.jobs['serial-windows'])) {
      throw new TypeError('CI workflow must define windows, windows-native, node-24, node-24-coverage, node-24-consumers, and all-checks-passed; ci-master must define wine-apt-cache and serial-windows')
    }

    /** 中文说明：变量 windows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const windows = workflow.jobs.windows
    /** 中文说明：变量 windowsNative 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const windowsNative = workflow.jobs['windows-native']
    /** 中文说明：变量 wineAptCache 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wineAptCache = masterWorkflow.jobs['wine-apt-cache']
    /** 中文说明：变量 serialWindows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const serialWindows = masterWorkflow.jobs['serial-windows']
    /** 中文说明：变量 node24 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const node24 = workflow.jobs['node-24']
    /** 中文说明：变量 node24Coverage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const node24Coverage = workflow.jobs['node-24-coverage']
    /** 中文说明：变量 node24Consumers 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const node24Consumers = workflow.jobs['node-24-consumers']
    /** 中文说明：变量 aggregate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aggregate = workflow.jobs['all-checks-passed']
    if (!Array.isArray(windows.steps) || !Array.isArray(aggregate.needs)) {
      throw new TypeError('Windows job must define steps and the aggregate must define needs')
    }
    /** 中文说明：函数值 commandSteps 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const commandSteps = windows.steps.filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))

    // Required PR job: Wine on ubuntu-latest, runs wine-windows-gates.sh.
    expect(windows['runs-on']).toBe('ubuntu-latest')
    expect(windows.name).toBe('windows node 24 / wine blocking')
    expect(windows.if).toBe("github.event_name == 'pull_request'")
    expect(commandSteps.some(step => step.run.includes('wine-windows-gates.sh'))).toBe(true)

    // windows-native: non-blocking native job with failover, runs windows-complete.
    // Its pool is resolved by the Windows-specific switch.
    expect(typeof windowsNative['runs-on']).toBe('string')
    expect(windowsNative['runs-on']).toContain('DSH_CI_FAILOVER_WINDOWS')
    expect(windowsNative['runs-on']).not.toContain('DSH_CI_FAILOVER_LINUX')
    expect(windowsNative['runs-on']).toContain('self-hosted')
    expect(windowsNative['runs-on']).toContain('dsh-win-ci')
    expect(windowsNative['runs-on']).toContain('dsh-windows-2025-16core')
    expect(windowsNative.name).toBe('windows node 24 / native complete')
    expect(windowsNative.if).toBe("github.event_name == 'pull_request'")
    expect(windowsNative.env).toMatchObject({
      DSH_COVERAGE_TEST_TIMEOUT_MS: '30000',
    })
    /** 中文说明：变量 nativeSteps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nativeSteps = windowsNative.steps as unknown[]
    /** 中文说明：函数值 nativeCommandSteps 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const nativeCommandSteps = nativeSteps.filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))
    expect(nativeCommandSteps.map(step => step.run)).toContain('pnpm run check:ci:windows-complete')

    // wine-apt-cache: master-only, seeds the Wine apt cache, lives in ci-master.
    expect(wineAptCache.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    expect(wineAptCache['runs-on']).toBe('ubuntu-latest')

    // serial-windows: master-only standby, self-hosted, non-blocking, lives in ci-master.
    expect(serialWindows.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    expect(serialWindows['runs-on']).toEqual(['self-hosted', 'dsh-win-ci', 'windows'])
    expect(serialWindows.name).toBe('serial / windows (self-hosted standby)')

    // Aggregate: Wine `windows` required, native `windows-native` excluded.
    expect(aggregate.needs).toContain('windows')
    expect(aggregate.needs).not.toContain('windows-native')
    expect(aggregate.needs).not.toContain('serial-windows')

    // Linux failover is a separate switch: the three required Linux workers
    // and the verdict job resolve their pool through DSH_CI_FAILOVER_LINUX,
    // never the Windows switch.
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const [jobName, job] of [['node-24', node24], ['node-24-coverage', node24Coverage], ['node-24-consumers', node24Consumers]] as const) {
      expect(typeof job['runs-on']).toBe('string')
      expect(job['runs-on'], `${jobName} runs-on must use the Linux failover switch`).toContain('DSH_CI_FAILOVER_LINUX')
      expect(job['runs-on'], `${jobName} runs-on must not use the Windows failover switch`).not.toContain('DSH_CI_FAILOVER_WINDOWS')
      expect(job['runs-on']).toContain('vm-backup')
    }
    expect(aggregate['runs-on']).toContain('DSH_CI_FAILOVER_LINUX')
    expect(aggregate['runs-on']).not.toContain('DSH_CI_FAILOVER_WINDOWS')
    expect(aggregate['runs-on']).toContain('vm-backup')
  })

  it('exempts push from cancellation in ci-master, so one master merge does not cancel the running drill', () => {
    /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflow = loadWorkflow('.github/workflows/ci-master.yml')
    /** 中文说明：变量 prWorkflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prWorkflow = loadWorkflow('.github/workflows/ci.yml')
    if (!isRecord(workflow.jobs) || !isRecord(workflow.concurrency)) {
      throw new TypeError('ci-master workflow must define jobs and a workflow-level concurrency block')
    }
    if (!isRecord(prWorkflow.jobs)) {
      throw new TypeError('ci workflow must define jobs')
    }

    // Cancellation applies to the whole superseded RUN, so this has to be
    // decided at workflow level and gated on the event: a job-level group
    // cannot exempt its job from its run being cancelled. Only push is exempt —
    // a drill takes longer than the interval between master merges. The negated
    // form is load-bearing: `== 'pull_request'` would also stop cancelling
    // workflow_dispatch, and a re-dispatched runner benchmark holds up to 12
    // larger runners for 15 minutes in this same group on master.
    expect(workflow.concurrency['cancel-in-progress']).toBe("${{ github.event_name != 'push' }}")

    // The PR-only ci.yml still cancels a superseded run on a new push, so a
    // fresh head does not stack a second full 9-job run behind a stale one.
    // Unlike ci-master it has no push carve-out: every PR event supersedes.
    expect(prWorkflow.concurrency).toMatchObject({
      'cancel-in-progress': true,
    })

    // The exact event sets are what keep master-only jobs out of the PR check
    // panel: ci-master triggers only on push(master) + workflow_dispatch and
    // never on pull_request; ci.yml is exactly pull_request-only. Assert the
    // full sets so losing the wrong event, or gaining an extra one, fails.
    if (!isRecord(workflow.on) || !isRecord(prWorkflow.on)) {
      throw new TypeError('both CI workflows must define on')
    }
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch'])
    expect(Object.keys(prWorkflow.on)).toEqual(['pull_request'])

    // Neither drill may carry a job-level group: it would not exempt the job
    // from run-scoped cancellation.
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const name of ['serial-linux-selfhosted', 'serial-windows']) {
      /** 中文说明：变量 job 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const job = workflow.jobs[name]
      if (!isRecord(job)) throw new TypeError(`${name} must be defined`)
      expect(job.concurrency).toBeUndefined()
      // Both stay master-push-only; that is what makes the push carve-out safe.
      expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    }

    // What bounds the cost of exempting push: a master push may only carry the
    // cache seeder and the two drills. Any job reachable on push would start
    // accumulating uncancelled runs, so the set is pinned here.
    /** 中文说明：常量 NOT_PUSH_REACHABLE 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
    const NOT_PUSH_REACHABLE = new Set([
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'larger-runner-benchmark'",
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'consolidated-runner-benchmark'",
    ])
    /** 中文说明：变量 pushReachable 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pushReachable = Object.entries(workflow.jobs)
      .filter(([, job]) => {
        if (!isRecord(job)) return false
        if (job.if === undefined) return true // unconditional: runs on every event
        if (job.if === false) return false // `if: false` parses as a boolean
        if (typeof job.if !== 'string') return true // unrecognized shape: surface it
        return !NOT_PUSH_REACHABLE.has(job.if.trim())
      })
      .map(([name]) => name)
      .sort()
    expect(pushReachable).toEqual(['serial-linux-selfhosted', 'serial-windows', 'wine-apt-cache'])

    // Why workflow_dispatch must keep cancelling: each benchmark fans out to a
    // dozen larger runners at once, in this same group on master. If it stopped
    // cancelling, a re-dispatch would queue ahead of a drill instead of
    // replacing the stale measurement.
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const name of ['larger-runner-benchmark', 'consolidated-runner-benchmark']) {
      /** 中文说明：变量 job 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const job = workflow.jobs[name]
      if (!isRecord(job) || !isRecord(job.strategy)) {
        throw new TypeError(`${name} must define a matrix strategy`)
      }
      expect(job.strategy['max-parallel']).toBe(12)
      expect(job['timeout-minutes']).toBe(15)
    }
  })

  it('keeps supported LSP source under native Windows coverage', () => {
    /** 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain('packages/lsp/lsp-stdio/src/connection.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/index.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/instance.ts')
  })

  it('requires one release-shaped Python runtime target on every pull request', () => {
    /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    /** 中文说明：变量 pythonRuntime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pythonRuntime = workflowJob(workflow, 'python-runtime')
    /** 中文说明：变量 aggregate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aggregate = workflowJob(workflow, 'all-checks-passed')
    if (!Array.isArray(aggregate.needs)) {
      throw new TypeError('CI aggregate must define required job dependencies')
    }

    expect(pythonRuntime).toMatchObject({
      if: "github.event_name == 'pull_request'",
      name: 'python runtime / release-shaped Linux x64',
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: {
        targets: 'node24-linux-x64',
        ci: true,
      },
    })
    expect(aggregate.needs).toContain('python-runtime')
  })

  it('keeps every Vitest project process-isolated on native Windows', () => {
    /** 中文说明：变量 config 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain("pool: process.platform === 'win32' ? 'threads' : 'forks'")
    expect(config.match(/pool: 'forks'/g)).toHaveLength(2)
  })
})

describe('DeepSeek e2e workflow', () => {
  it('prepares bubblewrap from the pinned payload without a package transaction', () => {
    /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflow = loadWorkflow('.github/workflows/e2e.yml')
    /** 中文说明：变量 e2e 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const e2e = workflowJob(workflow, 'e2e')
    if (!Array.isArray(e2e.steps)) throw new TypeError('DeepSeek e2e workflow must define steps')

    /** 中文说明：变量 steps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const steps = e2e.steps.filter(isRecord)
    expect(steps.find(step => step.name === 'Prepare bubblewrap (unrestrict userns)')).toMatchObject({
      run: 'bash scripts/prepare-ci-bubblewrap.sh',
    })
    expect(JSON.stringify(steps)).not.toContain('apt-get')
  })
})

describe('E2B e2e workflow', () => {
  it('is manual-only and fails loud before running the focused live suite', () => {
    /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflow = loadWorkflow('.github/workflows/e2b-e2e.yml')
    expect(workflow.on).toEqual({ workflow_dispatch: null })
    if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs.e2b) || !Array.isArray(workflow.jobs.e2b.steps)) {
      throw new TypeError('E2B e2e workflow must define the e2b job steps')
    }

    /** 中文说明：变量 steps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const steps = workflow.jobs.e2b.steps.filter(isRecord)
    /** 中文说明：函数值 preflight 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const preflight = steps.find(step => step.name === 'Preflight (require E2B API key)')
    /** 中文说明：函数值 e2b 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const e2b = steps.find(step => step.name === 'E2B tests (live sandbox)')

    expect(preflight).toMatchObject({
      env: { E2B_API_KEY: '${{ secrets.E2B_API_KEY_EXTERNAL }}' },
    })
    expect(preflight?.run).toContain('E2B_API_KEY_EXTERNAL repository secret')
    expect(e2b).toMatchObject({
      env: {
        E2B_API_KEY: '${{ secrets.E2B_API_KEY_EXTERNAL }}',
        DSH_E2E_MAX_WORKERS: '1',
        DSH_EXAMPLE_MODE: 'lib',
      },
    })
    expect(e2b?.run).toContain('packages/e2b/e2b/tests/composition.e2e.ts')
  })
})

describe('Python release workflows', () => {
  it('keeps complete wheel validation separate from protected public publication', () => {
    /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflow = loadWorkflow('.github/workflows/python-release.yml')
    /** 中文说明：变量 dispatch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispatch = workflowEvent(workflow, 'workflow_dispatch')
    /** 中文说明：变量 pullRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pullRequest = workflowEvent(workflow, 'pull_request')
    /** 中文说明：变量 build 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const build = workflowJob(workflow, 'build')
    /** 中文说明：变量 pythonCompat 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pythonCompat = workflowJob(workflow, 'python-compat')
    /** 中文说明：变量 validate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const validate = workflowJob(workflow, 'validate')
    /** 中文说明：变量 publishRuntime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const publishRuntime = workflowJob(workflow, 'publish-runtime')
    /** 中文说明：变量 publishSdk 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const publishSdk = workflowJob(workflow, 'publish-sdk')
    if (!isRecord(dispatch.inputs)
      || !isRecord(dispatch.inputs.publish)
      || !Array.isArray(pythonCompat.steps)
      || !Array.isArray(validate.steps)
      || !Array.isArray(publishRuntime.steps)
      || !Array.isArray(publishSdk.steps)) {
      throw new TypeError('Python release workflow must define publish input and release steps')
    }

    expect(dispatch.inputs.publish).toMatchObject({ type: 'boolean', default: false })
    expect(pullRequest).toEqual({ types: ['labeled'] })
    expect(build).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' || github.event.label.name == 'python-release-dry-run'",
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: {
        targets: 'node24-linux-x64,node24-linux-arm64,node24-macos-arm64',
        release: true,
      },
    })
    expect(pythonCompat.strategy).toMatchObject({ matrix: { python: ['3.10', '3.14'] } })
    /** 中文说明：变量 pythonCompatSteps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pythonCompatSteps = JSON.stringify(pythonCompat.steps)
    expect(pythonCompatSteps).toContain('dist/deepseek_harness_sdk-$VERSION-py3-none-any.whl')
    expect(pythonCompatSteps).toContain('dist/deepseek_harness_runtime_bin-$VERSION-py3-none-manylinux_2_28_x86_64.whl')
    expect(pythonCompatSteps).not.toContain('--find-links')
    /** 中文说明：变量 validateSteps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const validateSteps = JSON.stringify(validate.steps)
    /** 中文说明：函数值 authorize 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const authorize = validate.steps.filter(isRecord).find(step => step.name === 'Authorize publication request')
    if (!isRecord(authorize) || typeof authorize.run !== 'string') {
      throw new TypeError('Python release validation must authorize publication requests')
    }
    expect(validateSteps).toContain('PUBLIC_PYPI_RELEASE_ENABLED')
    expect(authorize).toMatchObject({
      env: {
        PYPI_PUBLISHER_REPOSITORY: '${{ vars.PYPI_PUBLISHER_REPOSITORY }}',
        REPOSITORY: '${{ github.repository }}',
      },
    })
    expect(authorize.run).toContain('[ "$REPOSITORY" = "$PYPI_PUBLISHER_REPOSITORY" ]')
    expect(validateSteps).toContain('100000000')
    expect(publishRuntime).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' && inputs.publish",
      needs: 'validate',
      environment: 'pypi-runtime',
      permissions: { contents: 'read', 'id-token': 'write' },
    })
    expect(publishSdk).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' && inputs.publish",
      needs: ['validate', 'publish-runtime'],
      environment: 'pypi',
      permissions: { contents: 'read', 'id-token': 'write' },
    })
    /** 中文说明：变量 runtimeSteps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtimeSteps = publishRuntime.steps.filter(isRecord)
    /** 中文说明：变量 sdkSteps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sdkSteps = publishSdk.steps.filter(isRecord)
    /** 中文说明：函数值 runtimePublish 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const runtimePublish = runtimeSteps.find(step => step.name === 'Publish runtime wheels')
    /** 中文说明：函数值 sdkPublish 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const sdkPublish = sdkSteps.find(step => step.name === 'Publish SDK wheel')
    /** 中文说明：函数值 runtimeHashes 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const runtimeHashes = runtimeSteps.find(step => step.name === 'Verify release artifact hashes')
    /** 中文说明：函数值 sdkHashes 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const sdkHashes = sdkSteps.find(step => step.name === 'Verify release artifact hashes')
    expect([...runtimeSteps, ...sdkSteps].some(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )).toBe(false)
    expect([...runtimeSteps, ...sdkSteps].filter(
      step => step.uses === 'pypa/gh-action-pypi-publish@release/v1',
    )).toHaveLength(2)
    expect(runtimePublish).toMatchObject({
      with: { 'packages-dir': 'dist/runtime/', attestations: false },
    })
    expect(sdkPublish).toMatchObject({
      with: { 'packages-dir': 'dist/sdk/', attestations: false },
    })
    expect(runtimeHashes).toMatchObject({ run: 'cd dist && sha256sum -c SHA256SUMS' })
    expect(sdkHashes).toMatchObject({ run: 'cd dist && sha256sum -c SHA256SUMS' })
  })

  it('exposes the native wheel builder to the release caller with normalized versions', () => {
    /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    /** 中文说明：变量 call 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const call = workflowEvent(workflow, 'workflow_call')
    /** 中文说明：变量 plan 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plan = workflowJob(workflow, 'plan')
    /** 中文说明：变量 build 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const build = workflowJob(workflow, 'build')
    if (!isRecord(call.inputs) || !Array.isArray(plan.steps) || !Array.isArray(build.steps)) {
      throw new TypeError('Python wheel builder must define workflow_call inputs and plan steps')
    }

    /** 中文说明：变量 buildSteps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const buildSteps: unknown[] = build.steps
    /** 中文说明：函数值 manylinuxAddon 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const manylinuxAddon = buildSteps.find(step => isRecord(step) && step.name === 'Rebuild Linux node-pty against manylinux 2.28')
    /** 中文说明：函数值 macosCheck 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const macosCheck = buildSteps.find(step => isRecord(step) && step.name === 'Check macOS deployment target')
    /** 中文说明：函数值 manylinuxSmoke 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const manylinuxSmoke = buildSteps.find(step => isRecord(step) && step.name === 'Run wheel in a manylinux 2.28 container')
    expect(call.inputs).toHaveProperty('targets')
    expect(call.inputs).toMatchObject({
      ci: { type: 'boolean', default: false },
      release: { type: 'boolean', default: false },
    })
    expect(workflow.concurrency).toMatchObject({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
    })
    expect(plan.if).toContain('inputs.ci')
    expect(plan.if).toContain('inputs.release')
    expect(JSON.stringify(plan.steps)).toContain('pep440_version')
    /** 中文说明：变量 workflowJson 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflowJson = JSON.stringify(workflow)
    expect(workflowJson).toContain('macosx_14_0_arm64')
    expect(workflowJson).toContain('dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).not.toContain('--find-links dist-python')
    expect(workflowJson).not.toContain('--find-links /work/dist-python')
    expect(manylinuxAddon).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_x86_64')
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_aarch64')
    expect(JSON.stringify(manylinuxAddon)).toContain('npm_config_build_from_source=true pnpm run install')
    expect(JSON.stringify(manylinuxAddon)).toContain('$HOME/setup-pnpm:$HOME/setup-pnpm:ro')
    expect(JSON.stringify(manylinuxAddon)).toContain('node-pty-glibc-versions.txt')
    expect(JSON.stringify(manylinuxAddon)).toContain('le 2.28')
    expect(macosCheck).toMatchObject({ if: "runner.os == 'macOS'" })
    expect(JSON.stringify(macosCheck)).toContain('scripts/check-macos-deployment-target.py')
    expect(JSON.stringify(macosCheck)).toContain('$EXE-spawn-helper')
    expect(manylinuxSmoke).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxSmoke)).toContain('-e DSH_TELEMETRY_DISABLED')
  })

  it('uses the shared macOS deployment-target check in GitLab', () => {
    /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflow = loadWorkflow('.gitlab-ci.yml')
    /** 中文说明：变量 runtimeWheel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtimeWheel = workflow['.runtime-wheel']
    if (!isRecord(runtimeWheel) || !Array.isArray(runtimeWheel.script)) {
      throw new TypeError('GitLab CI must define the runtime wheel script')
    }
    /** 中文说明：变量 runtimeScript 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtimeScript: unknown[] = runtimeWheel.script
    /** 中文说明：变量 macosCheck 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const macosCheck = runtimeScript.find(
      step => typeof step === 'string' && step.includes('PLATFORM" = macos-arm64'),
    )
    if (typeof macosCheck !== 'string') {
      throw new TypeError('GitLab CI must check the macOS deployment target')
    }

    expect(macosCheck).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck).toContain('"$EXE" "$EXE-spawn-helper"')
  })
})

describe('Issue lifecycle workflow', () => {
  it('runs the lifecycle job on every PR/review event but gates token and board steps', () => {
    /** 中文说明：变量 lifecycle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lifecycle = loadWorkflow('.github/workflows/issue-lifecycle.yml')
    /** 中文说明：变量 policy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const policy = loadWorkflow('.github/workflows/issue-policy.yml')
    /** 中文说明：变量 lifecycleJob 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lifecycleJob = workflowJob(lifecycle, 'lifecycle')
    if (!Array.isArray(lifecycleJob.steps)) throw new TypeError('Issue lifecycle job must define steps')

    // The job has no job-level `if`, so it is listed on every pull_request /
    // pull_request_review event and reports success instead of a gray skip. The
    // write-capable steps are gated at step level so approved/commented reviews
    // never mint a Project/Issue App token nor touch the board.
    expect(lifecycle.on).toHaveProperty('pull_request')
    expect(lifecycle.on).toHaveProperty('pull_request_review')
    expect(lifecycleJob.if).toBeUndefined()
    // Keep the subscription-type gates: issue-lifecycle does not re-subscribe
    // ready_for_review (issue-policy owns that) and only reacts to submitted
    // review events.
    /** 中文说明：变量 lifecyclePullRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lifecyclePullRequest = workflowEvent(lifecycle, 'pull_request')
    /** 中文说明：变量 lifecycleReview 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lifecycleReview = workflowEvent(lifecycle, 'pull_request_review')
    expect(lifecyclePullRequest.types).not.toContain('ready_for_review')
    expect(lifecyclePullRequest.types).toContain('review_requested')
    expect(lifecycleReview.types).toEqual(['submitted'])
    /** 中文说明：变量 gated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gated = "${{ github.event_name != 'pull_request_review' || github.event.review.state == 'changes_requested' }}"
    /** 中文说明：变量 steps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const steps = lifecycleJob.steps.filter(isRecord)
    /** 中文说明：函数值 tokenStep 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const tokenStep = steps.find(s => s.name === 'Create project token')
    /** 中文说明：函数值 handleStep 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const handleStep = steps.find(s => s.name === 'Handle repository event')
    expect(tokenStep).toMatchObject({ if: gated })
    expect(handleStep).toMatchObject({ if: gated })

    // issue-policy owns PR validation; it is read-only and a real gate.
    /** 中文说明：变量 policyPullRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const policyPullRequest = workflowEvent(policy, 'pull_request')
    expect(policyPullRequest.types).toContain('ready_for_review')
  })
})

describe('npm release workflows', () => {
  it('keeps publication dispatch-only and pack in the PR workflow', () => {
    // pack stays in the PR/master release workflows so a PR proves the set packs.
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const file of ['release.yml', 'release-vendor.yml']) {
      /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const workflow = loadWorkflow(`.github/workflows/${file}`)
      if (!isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      expect(Object.keys(workflow.jobs).sort()).toEqual(['pack'])
    }

    // publication is workflow_dispatch-only (never a PR check) and keeps the
    // npm-publish environment plus the shared dist-tag group.
    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const file of ['release-publish.yml', 'release-vendor-publish.yml']) {
      /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const workflow = loadWorkflow(`.github/workflows/${file}`)
      if (!isRecord(workflow.on) || !isRecord(workflow.jobs)) throw new TypeError(`${file} must define on and jobs`)
      expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
      /** 中文说明：变量 publish 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const publish = workflow.jobs.publish
      if (!isRecord(publish)) throw new TypeError(`${file} must define a publish job`)
      expect(publish.environment).toBe('npm-publish')
      expect(publish.concurrency).toMatchObject({ group: 'Release-publish' })
    }
  })
})

describe('Documentation site publication', () => {
  it('keeps Pages deployment dispatch-only from a dsh-v* tag', () => {
    /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const workflow = loadWorkflow('.github/workflows/docs-pages.yml')
    /** 中文说明：变量 build 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const build = workflowJob(workflow, 'build')
    /** 中文说明：变量 deploy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const deploy = workflowJob(workflow, 'deploy')
    if (!isRecord(workflow.on) || !isRecord(workflow.env) || !Array.isArray(build.steps)) {
      throw new TypeError('Documentation deployment must define on, env, and build steps')
    }

    // The site presents a released snapshot: a merge must never publish it, and
    // publication must never appear as a PR check.
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])

    // RELEASE_PUBLISH makes release:verify reject every ref that is not a dsh-v*
    // tag naming this tree's version, so the site and the npm sequence share one
    // definition of a released version.
    /** 中文说明：变量 steps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const steps = build.steps.filter(isRecord)
    /** 中文说明：函数值 verify 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const verify = steps.find(step => step.name === 'Verify release version')
    /** 中文说明：变量 checkout 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const checkout = steps.find(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )
    expect(verify).toMatchObject({
      env: { RELEASE_PUBLISH: 'true' },
      run: 'pnpm run release:verify --family dsh',
    })
    // Complete history: the release scripts read tags.
    expect(checkout).toMatchObject({ with: { 'fetch-depth': 0 } })

    // Projected source links stay on the public repository's master. That
    // repository advances only to each release commit, so its master never
    // carries unreleased work, while it retains only the most recent tags:
    // following the dispatched tag would leave every source link on a deploy
    // from an older tag unresolvable.
    expect(workflow.env.DOCS_REPOSITORY_REF).toBe('master')

    // The environment owns the deployment tag policy and the required reviewers.
    expect(deploy.environment).toMatchObject({ name: 'github-pages' })
  })
})

describe('Git hooks', () => {
  it('leaves frozen Agent Note sidecars to the archive verifier', () => {
    /** 中文说明：变量 lefthook 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lefthook = loadWorkflow('lefthook.yml')

    /** 中文说明：该循环依次处理文件或数据；循环变量仅在当前循环中有效。 */
    for (const hookName of ['pre-commit', 'pre-merge-commit']) {
      /** 中文说明：变量 hook 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const hook = lefthook[hookName]
      if (!isRecord(hook) || !Array.isArray(hook.jobs)) {
        throw new TypeError(`lefthook must define ${hookName} jobs`)
      }
      /** 中文说明：变量 pairing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const pairing: unknown = hook.jobs.find(
        (job: unknown) => isRecord(job) && job.name === 'translation pairing (staged records)',
      )

      expect(pairing).toMatchObject({ exclude: ['.agents/notes/archived/**'] })
    }
  })
})

/** 中文说明：函数 loadWorkflow 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function loadWorkflow(path: string): Record<string, unknown> {
  /** 中文说明：变量 workflow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

/** 中文说明：函数 workflowEvent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isRecord(workflow.on) || !isRecord(workflow.on[event])) {
    throw new TypeError(`workflow must define the ${event} event`)
  }
  return workflow.on[event]
}

/** 中文说明：函数 workflowJob 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function workflowJob(workflow: Record<string, unknown>, job: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[job])) {
    throw new TypeError(`workflow must define the ${job} job`)
  }
  return workflow.jobs[job]
}

/** 中文说明：函数 isRecord 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
