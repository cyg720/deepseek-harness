/*
 * ================================ 文件注释 ================================
 * 【文件职责】外观设置行的槽位存储：主题服务快照的镜像。插件的 apply 世界
 *             变更监听器是唯一写入者；行组件经 props.useStore 读取。
 * 【技术维度】defineStore 工厂 + 修订号守卫：revision 单调比较，防止旧快照
 *             覆盖新状态（初始 -1 使修订 0 也能作为一次变更落地）。
 * 【产品维度】设置页"外观"行：显示当前主题偏好（浅色/深色/跟随系统）。
 * 【逻辑维度】sync 动作在修订号前进时更新偏好与修订号。
 * 【关键边界】读取偏好永远用持久化偏好而非解析后的活动主题。
 * 【新手阅读建议】与 ui-theme/client/index.ts 的接线对照阅读。
 * ==========================================================================
 */
/**
 * Appearance and font-size row slot stores: mirrors of the theme service
 * snapshot. The plugin's apply-world change listener is the only writer; the
 * row components read via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_FONT_SIZE, type ThemePreference } from '../theme-settings.ts'

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Persisted preference (selection state reads this, never the resolved active theme). */
  preference: ThemePreference
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (draft: AppearanceRowState, preference: ThemePreference, revision: number) => void
}

/**
 * Declares the Appearance row state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({ preference: 'system', revision: -1 }),
    actions: {
      sync: (d, preference: ThemePreference, revision: number) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.revision = revision
      },
    },
  })
}

/** Store state mirrored from the theme snapshot's font size. */
export interface FontSizeRowState {
  /** Persisted content font size in px. */
  fontSize: number
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FontSizeRowActions = {
  sync: (draft: FontSizeRowState, fontSize: number, revision: number) => void
}

/**
 * Declares the font-size row state and write surface.
 * @returns the store handle.
 */
export function createFontSizeRowStore(): EngineStoreHandle<FontSizeRowState, FontSizeRowActions> {
  return defineStore({
    init: (): FontSizeRowState => ({ fontSize: DEFAULT_FONT_SIZE, revision: -1 }),
    actions: {
      sync: (d, fontSize: number, revision: number) => {
        if (revision <= d.revision) return
        d.fontSize = fontSize
        d.revision = revision
      },
    },
  })
}
