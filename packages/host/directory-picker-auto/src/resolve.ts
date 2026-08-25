/*
 * ================================ 文件注释 ================================
 * 【文件职责】自适应目录选择器组合的启动时后端解析：从采样的宿主事实到一个
 * 具体后端种类的纯决策。调用方每次启动只采样一次，因此挂载的能力在服务生命
 * 周期内保持稳定（接缝的要求）。
 * 【技术维度】纯函数：DirectoryPickerHostFacts（绑定主机/平台/环境/选择器二
 * 进制）→ 'native' | 'browse'；env 值是"设置且非空白"才算数（空 export 按
 * shell 惯例视为未设置）。
 * 【产品维度】自动决定用户用系统对话框还是应用内目录浏览器：本机有显示器且
 * 可服务就用 native，任何歧义都落到处处可用的 browse。
 * 【逻辑维度】类型（kind/env/facts）→ present 判定 → resolveDirectoryPickerBackend
 * 决策链。
 * 【关键边界】native 需要全部信号齐备：仅回环绑定（全接口绑定会接纳 OS 选择
 * 器触不到的远程浏览器）、非 SSH 启动（SSH 端口转发下选择器会开在无人值守的
 * 服务器上）、可服务的显示会话（darwin/win32 默认，linux 需 DISPLAY 或
 * WAYLAND_DISPLAY 且有选择器二进制，其余平台恒 false）。
 * 【新手阅读建议】把决策链的每一行对照"关键边界"逐条阅读。
 * ==========================================================================
 */
/**
 * Boot-time backend resolution for the adaptive directory-picker composition:
 * one pure decision from sampled host facts to a concrete backend kind. The
 * caller samples exactly once per boot, so the mounted capability stays
 * stable for the service lifetime as the seam requires.
 * @module @deepseek-ai/dsh-host-directory-picker-auto/resolve
 */

import type { Config as HttpServerConfig } from '@deepseek-ai/dsh-host-webserver'

/** Concrete interaction backend the resolver chooses between. */
// 解析器选择的两个具体交互后端。
export type DirectoryPickerBackendKind = 'native' | 'browse'

/** Environment keys the resolution reads (a `process.env` subset). */
// 解析读取的环境键（process.env 的子集）。
export type DirectoryPickerEnv = Readonly<
  Partial<Record<'SSH_CONNECTION' | 'SSH_TTY' | 'DISPLAY' | 'WAYLAND_DISPLAY', string>>
>

/** Host facts the backend choice is a pure function of, sampled once at boot. */
// 后端选择是其纯函数的宿主事实，启动时采样一次。
export interface DirectoryPickerHostFacts {
  /** Effective webserver bind host (the schema's closed loopback/all-interfaces union). */
  bindHost: HttpServerConfig['host']
  /** Host process platform. */
  platform: NodeJS.Platform
  /** Environment sample; SSH marks a remote operator, DISPLAY/WAYLAND_DISPLAY a Linux display. */
  env: DirectoryPickerEnv
  /** Whether a Linux chooser binary the native backend can drive (zenity/kdialog) is on PATH; consulted only when `platform` is linux. */
  linuxChooser: boolean
}

/** An env value counts only when set and non-blank (an empty export is "unset" by shell convention). */
const present = (value: string | undefined): boolean => value !== undefined && value !== ''

/**
 * Resolve which backend serves this boot. `native` requires every signal that
 * the operator can see the host display and the native backend can serve it:
 * a loopback-only bind (an all-interfaces bind admits remote browsers no OS
 * chooser can reach), no SSH launch (under SSH port-forwarding the chooser
 * would open on the unattended server), and a servable display session —
 * assumed on darwin/win32, requiring `DISPLAY`/`WAYLAND_DISPLAY` plus a
 * chooser binary on linux, and never true elsewhere (the native backend
 * drives exactly darwin/win32/linux). Anything ambiguous resolves to
 * `browse`, which works everywhere.
 * @param facts - the sampled host facts.
 * @returns the backend kind to mount.
 */
// 决策函数：native 需全部信号齐备，任何歧义都解析为处处可用的 browse。
export function resolveDirectoryPickerBackend(facts: DirectoryPickerHostFacts): DirectoryPickerBackendKind {
  if (facts.bindHost !== '127.0.0.1') return 'browse'
  if (present(facts.env.SSH_CONNECTION) || present(facts.env.SSH_TTY)) return 'browse'
  if (facts.platform === 'darwin' || facts.platform === 'win32') return 'native'
  if (facts.platform !== 'linux' || !facts.linuxChooser) return 'browse'
  return present(facts.env.DISPLAY) || present(facts.env.WAYLAND_DISPLAY) ? 'native' : 'browse'
}
