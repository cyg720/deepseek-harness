/** Assembled keyless snapshot for the default `dsh web` browser handoff. */
/*
 * 文件职责：快照验证构建版 dsh web 在本地、打开失败、远程 SSH 和非法环境配置下的浏览器交接。
 * 技术维度：使用 Execa、Node import hook、临时目录和内联快照运行真实发布装配。
 * 产品维度：用户启动 Web 后可自动打开可访问页面，失败或远程环境则得到安全明确的手动地址。
 * 逻辑维度：为每个场景启动隔离 CLI，提取就绪 URL、打开记录或诊断，归一化端口后对比快照。
 * 关键边界：需要 CLI 与前端构建产物；测试不能向浏览器子进程泄漏 API 密钥或 DSH_HOME。
 * 新手阅读建议：先看 BrowserOpenRecord，再按自动打开、失败、远程和非法 BROWSER 四个用例阅读。
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

/** 仓库根目录。 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
/** 构建后的 CLI Node 入口。 */
const builtBin = join(repoRoot, 'apps/cli/lib/bin.js')
/** 构建后的 Web 首页，用于判定测试是否可运行。 */
const frontendIndex = join(repoRoot, 'apps/web/dist/index.html')
/** 拦截默认浏览器打开动作并输出可验证记录的 Node 注册钩子。 */
const openerHook = new URL('./fixtures/web-browser-open/register.mjs', import.meta.url).href
/** CLI 在尝试打开默认浏览器前输出的固定提示。 */
const openingMessage = 'dsh web: opening the default browser; pass --no-open to disable'
/** 每个用例创建、结束后统一删除的临时根目录。 */
const tempRoots: string[] = []
/** CLI 与前端两个构建产物是否都存在。 */
const builtArtifactsExist = existsSync(builtBin) && existsSync(frontendIndex)

if (process.env.DSH_EXAMPLE_MODE === 'lib' && !builtArtifactsExist) {
  throw new Error('dsh web browser-open snapshot requires built CLI and Web artifacts in lib mode')
}

/** 每个用例后递归删除本轮创建的所有临时目录。 */
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 浏览器打开钩子输出的页面访问与环境泄漏记录。 */
interface BrowserOpenRecord {
  url: string
  status: number
  bootManifest: boolean
  apiKeyPresent: boolean
  dshHomePresent: boolean
}

/**
 * 将本地随机端口替换为稳定快照占位符。
 * @param url 带实际监听端口的本地 URL。
 * @returns 端口替换为 {{port}} 的 URL。
 * @example `normalizeLocalUrl('http://127.0.0.1:1234')`
 */
function normalizeLocalUrl(url: string): string {
  return url.replace(/:\d+$/, ':{{port}}')
}

describe.skipIf(!builtArtifactsExist)('dsh web browser-open assembled snapshot', () => {
  /** 正常本地启动应在应用稳定后打开可访问页面且不泄漏敏感环境。 */
  it('hands the reachable page to the default browser after the shipped tree settles', async () => {
    /** 正常打开场景的隔离工作目录。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-web-browser-open-snapshot-'))
    tempRoots.push(root)
    /** 构建版 Web CLI 的完整执行结果。 */
    const result = await execa(process.execPath, [
      '--import', openerHook,
      builtBin,
      'web',
      '--port', '0',
    ], {
      cwd: root,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'keyless-browser-open-no-call',
        DSH_AGENTS_HOME: join(root, '.agents'),
        DSH_HOME: join(root, '.dsh'),
        DSH_TELEMETRY_DISABLED: '1',
        NODE_NO_WARNINGS: '1',
        SSH_CONNECTION: '',
        SSH_TTY: '',
      },
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    /** CLI 输出的最终可访问 Web 地址。 */
    const readyUrl = /dsh web: (http:\/\/[^\s]+)/u.exec(result.stdout)?.[1]
    /** 打开钩子输出的结构化记录行。 */
    const openLine = result.stdout.split('\n').find(line => line.startsWith('dsh browser-open: '))
    /** 是否在实际打开前输出了用户提示。 */
    const opening = result.stdout.includes(openingMessage)
    if (readyUrl === undefined || openLine === undefined || !opening) {
      throw new Error(`dsh web browser-open evidence missing\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    /** 解析后的浏览器打开记录。 */
    const opened = JSON.parse(openLine.slice('dsh browser-open: '.length)) as BrowserOpenRecord

    expect({
      exitCode: result.exitCode,
      opening,
      readyUrl: normalizeLocalUrl(readyUrl),
      openedUrl: normalizeLocalUrl(opened.url),
      status: opened.status,
      bootManifest: opened.bootManifest,
      apiKeyPresent: opened.apiKeyPresent,
      dshHomePresent: opened.dshHomePresent,
      stderr: result.stderr,
    }).toMatchInlineSnapshot(`
      {
        "apiKeyPresent": false,
        "bootManifest": true,
        "dshHomePresent": false,
        "exitCode": 0,
        "openedUrl": "http://127.0.0.1:{{port}}",
        "opening": true,
        "readyUrl": "http://127.0.0.1:{{port}}",
        "status": 200,
        "stderr": "",
      }
    `)
  })

  /** 桌面打开失败时应保持 Web 成功运行并输出失败原因与手动地址。 */
  it('prints the launcher reason and manual URL after the Web app is ready', async () => {
    /** 打开失败场景的隔离工作目录。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-web-browser-open-failure-snapshot-'))
    tempRoots.push(root)
    /** 模拟桌面不可用后的 CLI 执行结果。 */
    const result = await execa(process.execPath, [
      '--import', openerHook,
      builtBin,
      'web',
      '--port', '0',
    ], {
      cwd: root,
      env: {
        ...process.env,
        BROWSER_OPEN_TEST_FAILURE: 'fixture desktop unavailable',
        DEEPSEEK_API_KEY: 'keyless-browser-open-no-call',
        DSH_AGENTS_HOME: join(root, '.agents'),
        DSH_BROWSER_OPEN_TEST_EXIT_ON_FAILURE: '1',
        DSH_HOME: join(root, '.dsh'),
        DSH_TELEMETRY_DISABLED: '1',
        NODE_NO_WARNINGS: '1',
        SSH_CONNECTION: '',
        SSH_TTY: '',
      },
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    /** CLI 最终输出的可访问地址。 */
    const readyUrl = /dsh web: (http:\/\/[^\s]+)/u.exec(result.stdout)?.[1]
    /** 已归一化端口的浏览器打开失败诊断。 */
    const diagnostic = result.stderr.split(/\r?\n/u)
      .find(line => line.startsWith('web-app: could not open the default browser because '))
      ?.replace(/http:\/\/127\.0\.0\.1:\d+/u, 'http://127.0.0.1:{{port}}')

    expect({
      diagnostic,
      exitCode: result.exitCode,
      opened: result.stdout.includes('dsh browser-open: '),
      opening: result.stdout.includes(openingMessage),
      readyUrl: readyUrl === undefined ? undefined : normalizeLocalUrl(readyUrl),
    }).toMatchInlineSnapshot(`
      {
        "diagnostic": "web-app: could not open the default browser because fixture desktop unavailable; visit http://127.0.0.1:{{port}} manually",
        "exitCode": 0,
        "opened": false,
        "opening": true,
        "readyUrl": "http://127.0.0.1:{{port}}",
      }
    `)
  })

  /** VS Code Remote SSH 环境只打印主机 URL，不尝试在远端打开浏览器。 */
  it('prints the host URL without launching a browser in a VS Code Remote SSH session', async () => {
    /** 远程 SSH 场景的隔离工作目录。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-web-browser-open-ssh-snapshot-'))
    tempRoots.push(root)
    /** 模拟 VS Code Remote SSH 环境后的执行结果。 */
    const result = await execa(process.execPath, [
      '--import', openerHook,
      builtBin,
      'web',
      '--port', '0',
    ], {
      cwd: root,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'keyless-browser-open-no-call',
        DSH_AGENTS_HOME: join(root, '.agents'),
        DSH_BROWSER_OPEN_TEST_EXIT_ON_READY: '1',
        DSH_HOME: join(root, '.dsh'),
        DSH_TELEMETRY_DISABLED: '1',
        NODE_NO_WARNINGS: '1',
        SSH_CONNECTION: '10.0.0.2 55000 10.0.0.9 22',
        SSH_TTY: '',
        VSCODE_IPC_HOOK_CLI: '/tmp/vscode-ipc',
      },
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    /** 远程场景仍应输出的可访问地址。 */
    const readyUrl = /dsh web: (http:\/\/[^\s]+)/u.exec(result.stdout)?.[1]

    expect({
      exitCode: result.exitCode,
      opening: result.stdout.includes(openingMessage),
      readyUrl: readyUrl === undefined ? undefined : normalizeLocalUrl(readyUrl),
      opened: result.stdout.includes('dsh browser-open: '),
      stderr: result.stderr,
    }).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "opened": false,
        "opening": false,
        "readyUrl": "http://127.0.0.1:{{port}}",
        "stderr": "",
      }
    `)
  })

  /** 项目 .env 中的 BROWSER 命令必须在 Web 启动前被来源策略拒绝。 */
  it('rejects a project browser command before starting the Web app', async () => {
    /** 非法项目环境场景的隔离工作目录。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-web-browser-open-env-snapshot-'))
    tempRoots.push(root)
    writeFileSync(join(root, '.env'), 'BROWSER=./project-browser\n')
    /** 项目 .env 含 BROWSER 时的失败执行结果。 */
    const result = await execa(process.execPath, [
      '--import', openerHook,
      builtBin,
      'web',
      '--port', '0',
    ], {
      cwd: root,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'keyless-browser-open-no-call',
        DSH_AGENTS_HOME: join(root, '.agents'),
        DSH_HOME: join(root, '.dsh'),
        DSH_TELEMETRY_DISABLED: '1',
        NODE_NO_WARNINGS: '1',
        SSH_CONNECTION: '',
        SSH_TTY: '',
      },
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })

    /** 已把机器绝对路径替换为稳定占位符的来源策略诊断。 */
    const diagnostic = result.stderr.split(/\r?\n/u)
      .find(line => line.startsWith('Error: dsh: '))
      ?.replace(/^Error: dsh: .*[/\\]\.env/u, 'dsh: {{root}}/.env')

    expect({
      diagnostic,
      exitCode: result.exitCode,
      opening: result.stdout.includes(openingMessage),
      opened: result.stdout.includes('dsh browser-open: '),
      ready: result.stdout.includes('dsh web: '),
    }).toMatchInlineSnapshot(`
      {
        "diagnostic": "dsh: {{root}}/.env sets "BROWSER", which only the launching environment may set (it decides how this process starts, where its code and instructions load from, or how it reaches the network); export BROWSER instead of putting it in a .env file",
        "exitCode": 1,
        "opened": false,
        "opening": false,
        "ready": false,
      }
    `)
  })
})
