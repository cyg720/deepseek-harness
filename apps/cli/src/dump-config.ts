/**
 * Config-dump entry for `dsh --profile <name> --dump-config`: compose the
 * profile's patch layers through the include plugin's patch algorithm without
 * booting or evaluating `!!js`, with one source layer per bundle, the
 * profile's own patch file, and each `--patch` overlay.
 * @module @deepseek-ai/dsh/dump-config
 */
/*
 * 中文说明：
 * - 文件职责：在不启动插件或执行 !!js 的情况下合并 profile 配置层并输出带来源注释的最终配置。
 * - 技术维度：使用补丁层算法、文件存在检查、路径解析和标准输出。
 * - 产品维度：帮助用户诊断 profile、用户补丁和命令行覆盖后的真实配置，支持损坏配置恢复。
 * - 逻辑维度：准备 profile 基础层，按需加入 profile/home/argv 补丁，再以空根文件渲染。
 * - 关键边界：defaultOnly 会完全跳过用户层和 --patch 解析；本入口不求值 JavaScript 标签。
 * - 新手阅读建议：先看 layers 的追加顺序，再对比 defaultOnly 为 true 和 false 时哪些文件被读取。
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  loadOptionalPatches,
  loadOverlayPatches,
  renderConfigDump,
  type ConfigDumpLayer,
} from '@deepseek-ai/dsh-app-boot'
import { homePatchPath, prepareProfile, PROFILE_ROOT_FILENAME } from './profile-boot.ts'

/** CLI 名称，用于补丁解析诊断。 */
const NAME = 'dsh'

/* v8 ignore start -- built-bin acceptance drives this boot-free dispatch */
/* 中文：该无启动分派由构建后 CLI 验收覆盖。 */
/**
 * Print a profile composition with comments naming each source file and patch layer.
 * @param profile - the profile name.
 * @param defaultOnly - omit the profile's user layer and `--patch` overlays
 * (the recovery diagnostic for a broken `cordis.patch.yml`, which is then
 * never parsed).
 * @param patches - `--patch` overlay paths, in argv order.
 */
/* 中文：输出 profile 合成配置；profile 是名称，defaultOnly 控制用户层，patches 按 argv 顺序覆盖，无返回值。 */
export function runDumpConfig(profile: string, defaultOnly: boolean, patches: readonly string[]): void {
  /** 已准备的 profile 目录、基础层与可选用户补丁。 */
  const loaded = prepareProfile(profile, !defaultOnly)
  /** 按包名标注来源的配置转储层列表。 */
  const layers: ConfigDumpLayer[] = loaded.layers.map(layer => ({
    label: layer.packageName,
    patches: layer.patches,
  }))
  if (!defaultOnly) {
    if (existsSync(loaded.patchPath)) {
      layers.push({ label: loaded.patchPath, patches: loaded.patches })
    }
    /** 当前用户主目录补丁文件路径。 */
    const homePatchFile = homePatchPath()
    /** 主目录补丁解析结果；文件不存在时为 undefined。 */
    const homePatches = loadOptionalPatches(NAME, homePatchFile)
    if (homePatches !== undefined) {
      layers.push({ label: homePatchFile, patches: homePatches })
    }
    /** argv 中当前一个额外补丁路径。 */
    for (const file of patches) {
      /** 当前额外补丁的绝对路径，用作读取位置和输出标签。 */
      const absolute = resolve(file)
      layers.push({ label: absolute, patches: loadOverlayPatches(NAME, absolute) })
    }
  }
  // The dump anchors on the same empty root file the boot includes.
  // 中文：转储与真实启动使用同一个空根文件作为补丁合并锚点。
  process.stdout.write(renderConfigDump(NAME, join(loaded.dir, PROFILE_ROOT_FILENAME), layers))
}
/* v8 ignore stop */
/* 中文：构建后 CLI 验收覆盖忽略区结束。 */
