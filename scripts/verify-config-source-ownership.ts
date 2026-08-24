/**
 * Gate for forbidden credential or endpoint environment inlines in shipped
 * Cordis configuration.
 * @module scripts/verify-config-source-ownership
 */
/**
 * 中文说明：
 * - 文件职责：扫描随产品发布的 Cordis 配置，禁止通过 !!js 直接内联凭据和端点环境读取。
 * - 技术维度：使用 Node globSync、逐行正则检查、路径标准化和可执行脚本入口。
 * - 产品维度：确保凭据走 ctx.credentials、端点走环境快照，避免绕过统一解析与安全策略。
 * - 逻辑维度：遍历固定配置 glob，逐文件逐行匹配禁用形式，收集定位诊断并按结果退出。
 * - 关键边界：这是普通单行形式检查而非完整 YAML 解析；只覆盖 SHIPPED_CONFIG_GLOBS。
 * - 新手阅读建议：先看扫描范围，再理解 INLINE_DENY 的字段集合，最后看直接运行时的退出规则。
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/** 仓库根目录绝对路径。 */
const ROOT = resolve(import.meta.dirname, '..')

/** Shipped Cordis configuration these rules apply to. */
/** 中文：本门禁覆盖的随产品发布 Cordis 配置 glob。 */
const SHIPPED_CONFIG_GLOBS = [
  'apps/*/config/*.yml',
  'examples/*/*.cordis.yml',
  'examples/*/cordis.yml',
  // Bundle identity comes from the package manifest, not the domain directory.
  // 中文：bundle 身份来自包清单而不是上级领域目录，因此使用两级包 glob。
  'packages/*/*/cordis.patch.yml',
  // The Python runtime ships its own default composition inside the wheel.
  // 中文：Python wheel 内也携带自己的默认 Cordis 组合，必须纳入扫描。
  'python/*/src/**/cordis.yml',
]

/** Ordinary single-line configuration forms this source check rejects; not full YAML analysis. */
/** 中文：拒绝凭据或端点字段直接绑定 !!js 的单行正则；不承担完整 YAML 解析。 */
const INLINE_DENY = /^\s*(apiKey|baseURL|apiKeyEnv|authToken|headers)\s*:\s*!!js\b/

/** Return every forbidden inline environment form in shipped configuration. */
/** 中文：扫描 root 下发布配置并返回所有违规诊断；参数为仓库根路径。示例：collectConfigSourceOwnershipViolations(ROOT)。 */
export function collectConfigSourceOwnershipViolations(root: string): string[] {
  /** 累积的文件、行号与修复说明。 */
  const failures: string[] = []
  /** 当前扫描的发布配置 glob。 */
  for (const glob of SHIPPED_CONFIG_GLOBS) {
    /** 当前 glob 命中的一个配置文件。 */
    for (const file of globSync(glob, { cwd: root })) {
      /** 使用正斜杠的仓库相对路径。 */
      const rel = file.split(sep).join('/')
      readFileSync(resolve(root, rel), 'utf8').split('\n').forEach((line, index) => {
        if (!INLINE_DENY.test(line)) return
        failures.push(
          `${rel}:${String(index + 1)}: inlines a credential or endpoint from the environment.`
          + ' The adapter resolves apiKeyEnv through ctx.credentials and the endpoint through the'
          + ' environment snapshot; inlining here bypasses both ladders.',
        )
      })
    }
  }
  return failures
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  /** 直接执行脚本时重新收集的全部违规。 */
  const failures = collectConfigSourceOwnershipViolations(ROOT)
  if (failures.length > 0) {
    process.stderr.write('verify-config-source-ownership: configuration source ownership violated:\n')
    /** 当前输出到标准错误的一条违规诊断。 */
    for (const failure of failures) process.stderr.write(`  ${failure}\n`)
    process.exit(1)
  }

  process.stdout.write(
    'verify-config-source-ownership: no credential or endpoint uses the ordinary inline environment form'
    + ' in shipped configuration.\n',
  )
}
