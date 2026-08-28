/**
 * ================================ 文件注释 ================================
 * 【文件职责】平台单例模块表：这些是 shell 共享进冻结模块表的唯一实体——
 *   拉取到的 bundle 通过 loader 的 require 恰好对照这组说明符解析外部依赖。
 * 【技术维度】值保持 shell 静态导入，使每个 bundle 看到同一实例；satisfies
 *   钉住投影契约（键集合与 PLATFORM_MODULES 一致）。
 * 【产品维度】插件 bundle 的 externals 由 tsdown 按平台清单外部化；种子表
 *   在运行时提供对应实例，避免 react/cordis 双实例。
 * 【逻辑维度】单函数 getStaticModules 返回说明符 -> 导出实体的表。
 * 【关键边界】键来自 platform.ts（与 tsdown 客户端外部化的单一事实源）；
 *   表与清单任何一侧增词而另一侧缺失都会编译失败。
 * 【新手阅读建议】对照 platform.ts 的 PLATFORM_MODULES 理解键集合。
 * ==========================================================================
 */
/**
 * Platform-singleton module-table. These are the ONLY entities the shell
 * shares into the frozen module table — fetch bundles resolve their externals
 * against exactly this set through the loader's require. Keys come from the
 * platform constant module ({@link ./platform.ts}, the single source
 * of truth with the tsdown client externals); values stay shell-static
 * imports so every bundle sees the same instance.
 */
/*
 * 平台单例模块表。这些是 shell 共享进冻结模块表的唯一实体——拉取 bundle
 * 通过 loader 的 require 恰好对照这组说明符解析其外部依赖。键来自平台
 * 常量模块（./platform.ts，与 tsdown 客户端外部化的单一事实源）；值保持
 * shell 静态导入，使每个 bundle 看到同一实例。
 */
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as ReactDomClient from 'react-dom/client'
import * as Cordis from '@deepseek-ai/cordis'
import * as ClientStore from '@deepseek-ai/dsh-client-store'
import * as UiSlots from '@deepseek-ai/dsh-client-ui-slots'
import * as UiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { PlatformModule } from './platform.ts'

/**
 * Build the static table handed to the module loader at boot.
 * @returns module specifier → exported entity (one entry per platform word).
 */
/*
 * 构建启动时交给模块加载器的静态表。
 * @returns 模块说明符 -> 导出实体（每个平台词一个条目）。
 */
export function getStaticModules(): Record<string, unknown> {
  // The satisfies pin is the projection contract: a word added to
  // PLATFORM_MODULES without a static import here (or vice versa) fails to
  // compile instead of drifting into a runtime require miss.
  // satisfies 钉住投影契约：给 PLATFORM_MODULES 加词而这里没有静态导入
  // （或反之）会编译失败，而不是漂移成运行时 require 未命中。
  return {
    'react': React,
    'react/jsx-runtime': ReactJsxRuntime,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    '@deepseek-ai/cordis': Cordis,
    '@deepseek-ai/dsh-client-store': ClientStore,
    '@deepseek-ai/dsh-client-ui-slots': UiSlots,
    '@deepseek-ai/dsh-client-ui-primitives': UiPrimitives,
  } satisfies Record<PlatformModule, unknown>
}
