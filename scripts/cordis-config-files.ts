/** Cordis Loader configuration file discovery. */
/*
 * 文件职责：集中提供仓库内 Cordis Loader YAML 配置文件的发现规则。
 * 技术维度：使用 Node.js globSync 按通配模式同步扫描，并返回排序后的仓库相对路径。
 * 产品维度：让配置校验、生成器和维护脚本共享同一份输入清单，避免遗漏可运行配置。
 * 逻辑维度：搜索文件名包含 cordis 的 yml/yaml，排除工具目录、依赖、vendor 和翻译旁车文件，再排序。
 * 关键边界：函数只按路径规则发现文件，不解析 YAML；root 必须指向待扫描的仓库根目录。
 * 新手阅读建议：先看包含模式，再逐项理解 exclude 为什么不能成为 Loader 输入。
 */

import { globSync } from 'node:fs'

/**
 * Return repository-relative Cordis Loader YAML paths under `root`.
 *
 * Translation consistency records are YAML sidecars, never Loader inputs.
 *
 * @param root Repository root to scan.
 * @returns Sorted repository-relative Loader configuration paths.
 */
/*
 * 返回 root 下按字典序排列的 Cordis Loader YAML 仓库相对路径。
 * 翻译一致性 YAML 是旁车记录，不能作为 Loader 配置返回。
 * @param root - 要扫描的仓库根目录，可以是相对路径或绝对路径。
 * @returns 排序后的配置文件相对路径数组；没有匹配项时返回空数组。
 * @example cordisConfigFiles('/repo') 可能返回 ['examples/cordis.yml']。
 */
export function cordisConfigFiles(root: string): string[] {
  // 包含模式常量：同时接受 .yml 与 .yaml，并要求文件名中出现 cordis。
  // 排除模式常量：忽略工具私有目录、依赖、第三方源码和翻译旁车记录。
  return globSync(['**/*cordis*.yml', '**/*cordis*.yaml'], {
    cwd: root,
    exclude: ['.claude/**', 'node_modules/**', 'vendor/**', '**/*.i18n.yaml'],
  }).sort()
}
