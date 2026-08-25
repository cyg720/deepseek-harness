/**
 * Build every native tool this host can build, into its per-platform
 * package.
 *
 * Targets are derived from the checked-in matrix: each
 * `packages/<name>/prebuilds.json` whose `platform` matches this host names
 * the binaries to produce; the TOOLS table below maps each `tool` to its C
 * source. Builds are NATIVE-ONLY — each Linux architecture compiles its own
 * binary with the distro's `musl-gcc` (static musl: runs on glibc and musl
 * distros alike, no loader or libc expectations on the consumer host), and
 * CI's per-arch runners are the builders of record. No cross toolchain
 * exists here on purpose: native runners replace it, and the audit surface
 * is the reviewed C source plus the CI job that built the binary.
 *
 * Binaries land in `packages/<name>/bin/` — git-ignored (root
 * `.gitignore`), packed into the platform package's npm tarball behind its
 * `prepack` gate (`scripts/verify-launcher-binary.mjs`).
 *
 * Run: `pnpm run build:native` (Linux with musl-gcc on PATH:
 * `apt-get install musl-tools`). Non-Linux hosts fail fast — no platform
 * package exists for them to build.
 */
/*
 * 文件职责：根据受检入平台矩阵，在当前 Linux 架构上原生编译所有声明的 Landlock 工具二进制。
 * 技术维度：使用 Node 同步文件 API、musl-gcc、静态链接、prebuilds.json 和原生进程执行。
 * 产品维度：为各平台 npm 包生成无动态 libc 依赖、可审计且可在发布门禁中验证的启动器。
 * 逻辑维度：读取当前平台目标，校验工具与二进制类型，创建输出目录，逐项调用 musl-gcc 并报告结果。
 * 关键边界：只允许 Linux 本机构建；不得交叉编译；未知工具或类型立即失败；警告按错误处理。
 * 新手阅读建议：先看 TOOLS 与 hostPlatform，再读目标矩阵收集循环，最后看编译参数和失败处理。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** Each native tool's C source, keyed by the `tool` field in prebuilds.json. */
/* 按 prebuilds.json 的 tool 名称映射到受审查 C 源文件。 */
const TOOLS: Record<string, { source: string }> = {
  'landlock-run': { source: 'packages/entry/src/main.c' },
}

/** landlock-run 子项目根目录的绝对路径。 */
const repoRoot = resolve(import.meta.dirname, '..')

if (process.platform !== 'linux') {
  console.error(`build: native tools are built natively per Linux architecture (no cross toolchain) — nothing to build on ${process.platform}. CI's per-arch runners build and rehearse every platform package.`)
  process.exit(1)
}
/** 当前构建主机在平台矩阵中的 linux-架构标识。 */
const hostPlatform = `linux-${process.arch}`

/** This host's platform packages, from the checked-in matrix. */
/* 当前平台包声明的全部待构建二进制目标。 */
const targets: { packageDir: string; tool: string; binaryPath: string; kind: string }[] = []
/** 包含入口包和所有平台包的目录。 */
const packagesRoot = join(repoRoot, 'packages')
for (const name of readdirSync(packagesRoot).sort()) {
  const prebuildsFile = join(packagesRoot, name, 'prebuilds.json')
  if (!existsSync(prebuildsFile)) continue
  const prebuilds = JSON.parse(readFileSync(prebuildsFile, 'utf8')) as {
    platform: string
    binaries: { tool: string; kind: string; path: string }[]
  }
  if (prebuilds.platform !== hostPlatform) continue
  for (const binary of prebuilds.binaries) {
    targets.push({ packageDir: join(packagesRoot, name), tool: binary.tool, binaryPath: binary.path, kind: binary.kind })
  }
}
if (targets.length === 0) {
  console.error(`build: no platform package declares binaries for ${hostPlatform} — supported platforms are the packages/*/prebuilds.json "platform" values.`)
  process.exit(1)
}

for (const target of targets) {
  const tool = TOOLS[target.tool]
  if (tool === undefined) {
    console.error(`build: prebuilds.json names unknown tool "${target.tool}" — add it to the TOOLS table in scripts/build.ts.`)
    process.exit(1)
  }
  if (target.kind !== 'static-musl') {
    console.error(`build: unknown binary kind "${target.kind}" — the only toolchain here is static musl.`)
    process.exit(1)
  }
  const binary = join(target.packageDir, target.binaryPath)
  mkdirSync(dirname(binary), { recursive: true })

  // -static against musl: self-contained, no loader/libc expectations on the
  // consumer host. -Werror is safe to keep hard: CI pins the builder images,
  // and a new warning on a toolchain bump deserves a look, not a pass.
  const result = spawnSync('musl-gcc', [
    '-std=c11', '-Os', '-Wall', '-Wextra', '-Werror', '-static', '-s',
    '-o', binary, join(repoRoot, tool.source),
  ], { stdio: ['ignore', 'inherit', 'inherit'] })
  if (result.error !== undefined || result.status !== 0) {
    console.error('build: musl-gcc failed' +
      (result.error ? ` (${result.error.message} — is musl-tools installed?)` : ''))
    process.exit(1)
  }
  console.log(`build: built ${basename(target.packageDir)}/${target.binaryPath}`)
}
