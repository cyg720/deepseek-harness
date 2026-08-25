/*
 * ================================ 文件注释 ================================
 * 【文件职责】fs 包的"不变式伴生插件"：对文件系统"决策事件流"（fs/write-intent、
 * fs/edit-intent、fs/observed）做事件数据自检——事件必须携带可用的目标身份。
 * 【技术维度】Cordis 伴生插件：用 internal/dispatch 监听所有事件分发，只检查本包的
 * 三个事件名；validateTarget 断言 targetKey/displayPath 非空，fs/observed 的 present
 * 观察断言 version 非空。
 * 【产品维度】在开发/测试期捕获"事件数据不完整"（空 targetKey/displayPath/version）
 * 这类内部错误，保证事件流的数据契约不被破坏。
 * 【逻辑维度】按出现顺序：PACKAGE_NAME（注册名）→ name/inject（插件元信息）→
 * validateTarget（目标身份校验）→ install（自检逻辑：dispatch 钩子按事件名分流）→
 * apply（注册入口）。
 * 【关键边界】以 { global: true } 注册监听所有上下文；只检查自有事件，其余事件名
 * 直接放行；自检只报告（fail）不改状态。
 * 【新手阅读建议】先看 validateTarget 理解"什么是不合法的事件数据"，再看 install
 * 的 dispatch 钩子理解如何拦截到事件。
 * ==========================================================================
 */
/** Package-owned filesystem event-data invariants. @module @deepseek-ai/dsh-fs/invariant */
/*
 * 模块总览：本文件自检文件系统事件流的数据完整性——事件要么不带目标，要带就
 * 必须是完整的（键、展示路径、版本都非空）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { FsObservation, FsTarget } from './types.ts'

// 不变式伴生插件的注册名。
const PACKAGE_NAME = '@deepseek-ai/dsh-fs'

/** Cordis companion plugin name. */
/* 伴生插件在 Cordis 中的插件名。 */
export const name = 'fs-invariant'
/** Service required before the companion can reserve package ownership. */
/* 依赖注入声明：必须先有 invariants 服务，本插件才能注册自检。 */
export const inject = ['invariants']

/** Assert that an event carries a usable opaque target identity. */
/*
 * 断言事件携带可用的不透明目标身份：targetKey 与 displayPath 都不得为空字符串。
 * fail 由 invariants 框架注入，触发后统一上报。
 */
function validateTarget(target: FsTarget, fail: (message: string) => never): void {
  if (target.targetKey.length === 0) fail('filesystem event targetKey must be non-empty')
  if (target.displayPath.length === 0) fail('filesystem event displayPath must be non-empty')
}

/** Install checks over the filesystem decision and observation event stream. */
/*
 * 安装对文件系统"决策/观察事件流"的检查：挂一个全局 dispatch 钩子，
 * 只对本包的三个事件名校验目标身份；对 fs/observed 再按 kind 分支校验
 * （present 必须有非空 version，kind 只能是 present 或 absent）。
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'fs/write-intent'
      && eventName !== 'fs/edit-intent'
      && eventName !== 'fs/observed') return
    validateTarget(args[0] as FsTarget, fail)
    if (eventName === 'fs/observed') {
      const observation = args[1] as FsObservation
      switch (observation.kind) {
        case 'present':
          if (observation.version.length === 0) fail('fs/observed present version must be non-empty')
          break
        case 'absent':
          break
        default:
          fail('fs/observed kind must be present or absent')
      }
    }
  }, { global: true })
}

/**
 * Register the filesystem invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 注册文件系统不变式伴生插件。
 * @param ctx 携带 invariants 服务的 Cordis 上下文。
 * @returns 注册成功后的注销函数。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
