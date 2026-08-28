/*
 * ================================ 文件注释 ================================
 * 【文件职责】语言行槽位存储：locale 服务快照的镜像。插件的 apply 世界
 *   变更监听器是唯一写入者；行组件经 props.useStore 读取。
 * 【技术维度】defineStore 声明式存储（运行时引擎）；sync 动作带修订号
 *   守卫（revision <= 当前则丢弃，保证顺序且去重）。
 * 【产品维度】设置页"语言"下拉行展示可选语言与当前激活项；初始 revision
 *   为 -1，使首个修订 0 也能作为变更落地。
 * 【逻辑维度】类型区（选项行/状态/动作形状）；createLanguageRowStore 声明
 *   存储（init 空态 + sync 动作）。
 * 【关键边界】revision 单调递增；sync 是唯一写路径（镜像语义，非权威源）。
 * 【新手阅读建议】先读 runtime 的 defineStore 契约再回看本文件。
 * ==========================================================================
 */
/**
 * Language row slot store: a mirror of the locale service snapshot. The
 * plugin's apply-world change listener is the only writer; the row component
 * reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** One selectable locale row (id + self-described label). */
/* 一个可选择的语言行（id + 自述标签）。 */
export interface LanguageOptionRow {
  /** Locale id (the setLocale argument). */
  /* 语言 id（setLocale 的参数）。 */
  id: string
  /** Display name in its own language (中文 / English). */
  /* 以其自身语言显示的标签（中文 / English）。 */
  label: string
}

/** Store state mirrored from the locale snapshot. */
/* 从 locale 快照镜像的存储状态。 */
export interface LanguageRowState {
  /** Active locale id. */
  /* 激活语言 id。 */
  active: string
  /** Selectable locales in display order. */
  /* 按展示顺序的可选语言。 */
  options: LanguageOptionRow[]
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  /* 服务修订号；首次同步前为 -1，使修订 0 也作为变更落地。 */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
/* 声明动作形状，给导出的工厂稳定返回类型。 */
type LanguageRowActions = {
  sync: (draft: LanguageRowState, active: string, options: LanguageOptionRow[], revision: number) => void
}

/**
 * Declares the Language row state and write surface.
 * @returns the store handle.
 */
/*
 * 声明语言行状态与写面。
 * @returns 存储句柄。
 */
export function createLanguageRowStore(): EngineStoreHandle<LanguageRowState, LanguageRowActions> {
  return defineStore({
    init: (): LanguageRowState => ({ active: '', options: [], revision: -1 }),
    actions: {
      sync: (d, active: string, options: LanguageOptionRow[], revision: number) => {
        if (revision <= d.revision) return // 修订号守卫：陈旧同步丢弃
        d.active = active
        d.options = options
        d.revision = revision
      },
    },
  })
}
