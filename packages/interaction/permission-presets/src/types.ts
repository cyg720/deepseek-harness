/**
 * Pure types of the permission domain: the ONE home of the `permissions`
 * projection-key declaration plus its payload types, free of this package's
 * host-side value imports (cordis, schemastery). Two namespace projections
 * serve it — the package root re-export for host consumers, `./client` (the
 * browser half-entry's re-export) for client aggregates — with zero content
 * duplication.
 *
 * @module @deepseek-ai/dsh-permission-presets/types
 */
/**
 * 文件职责：定义权限 preset 选项、权限选择投影及会话投影键的纯类型。
 * 技术维度：使用 TypeScript 接口和模块声明合并，供宿主与浏览器入口零重复共享。
 * 产品维度：让客户端展示可切换权限方案、当前有效值和无法匹配预设时的 custom 状态。
 * 逻辑维度：PresetOption 描述单项，PermissionSelect 描述整体，再把 permissions 加入 SessionProjectionMap。
 * 关键边界：投影键缺失表示未装配权限服务；custom 只在当前旋钮组合不匹配表项时出现。
 * 新手阅读建议：先看 PresetOption，再理解 options/currentValue，最后阅读模块声明合并的键缺失语义。
 */

/** The select-option shape a presentation layer advertises for one preset (or for the derived `custom` state). */
/** 展示层公开的单个权限 preset 或派生 custom 选项。 */
export interface PresetOption {
  /** Stable option value: the table key, or `custom`. */
  /** 稳定选项值：表键或 custom。 */
  value: string
  /** The display label. */
  /** 面向用户的显示名称。 */
  name: string
  /** One user-facing sentence on what the value means; omitted when not configured. */
  /** 可选的一句话说明；未配置时整个字段缺失。 */
  description?: string
}

/**
 * Whole `permissions` projection value: every switchable preset in table
 * order (plus the derived current-only `custom` when the knobs match no
 * entry) and the effective current value.
 */
/** 完整 permissions 投影值，包含顺序选项和当前有效值。 */
export interface PermissionSelect {
  /** Switchable presets, plus `custom` appended exactly while it is current. */
  /** 可切换 preset；仅当前为 custom 时在末尾追加 custom。 */
  options: PresetOption[]
  /** The effective current value: a preset table key, or `custom`. */
  /** 当前有效值：preset 表键或 custom。 */
  currentValue: string
}

// 扩展会话投影公共映射，使客户端可按 permissions 键取得类型化值。
declare module '@deepseek-ai/dsh-session-projection/types' {
  // 会话投影的可扩展字段映射。
  interface SessionProjectionMap {
    /**
     * The session's permission select, folded from the three whole-value
     * knob events (`permission/preset`, `sandbox/mode`, `approval/policy`)
     * over the composition defaults. Key absence means no permission service
     * is composed — clients hide the control.
     */
    /** 从三类完整权限事件和组合默认值折叠而来；键缺失时客户端隐藏权限控件。 */
    permissions: PermissionSelect
  }
}
