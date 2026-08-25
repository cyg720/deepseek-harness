/*
 * ================================ 文件注释 ================================
 * 【文件职责】设置外壳（sidebar.settings 占用者）的契约类型：导航行与引导步骤
 *             的投影、外壳根组件 props。
 * 【技术维度】纯类型：引用侧边栏槽位类型，故放在本包而非 ui-settings（后者是
 *             设置域基础层，依赖任何 ui-* 呈现包会经 ui-sidebar → ui-layout
 *             → ui-theme 闭合引用环）；设置槽位类型仍在 ui-settings。
 * 【产品维度】设置面板外壳的导航行、引导步骤与根组件 props 形态。
 * 【逻辑维度】SettingsSectionRow/SettingsOnboardingStep 投影行 → SettingsRootInjected
 *             （hooks 舱）→ SettingsRootComponentProps 全量 props。
 * 【关键边界】外壳不注册 store：弹窗开关与当前分区 id 是组件本地视图状态。
 * 【新手阅读建议】理解"外壳契约在此、槽位类型在 ui-settings"的依赖方向。
 * ==========================================================================
 */
/**
 * Settings shell contract — the types of the `sidebar.settings` occupant this
 * package renders. They live here rather than in ui-settings because they
 * reference the sidebar's own slot type: ui-settings is the settings domain's
 * base layer and must not depend on any `ui-*` presentation package, or the
 * reference graph closes a cycle through ui-sidebar → ui-layout → ui-theme.
 * The settings SLOT types (what registrants contribute) stay in ui-settings.
 */
import type { HostObservable, InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.settings' entry)
// into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the settings slot declarations the shell renders into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** One nav row projected from a settings.section registration's options. */
export interface SettingsSectionRow {
  id: string
  order: number
  label: string
}

/** One ordered onboarding step projected from a slot registration. */
export interface SettingsOnboardingStep {
  id: string
  order: number
}

/**
 * Registrant-private injected share of the settings shell (assembled in
 * apply): the ledger's nav-row projection as a hooks-compartment source —
 * the shell reads no locale state and subscribes through the bound hook.
 */
export type SettingsRootInjected = {
  hooks: {
    /** settings.section ledger projected into ordered nav rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
    /** settings.onboarding ledger projected into coordinator order. */
    onboardingSteps: HostObservable<readonly SettingsOnboardingStep[]>
  }
}

/**
 * Full component props of the settings shell root: the sidebar owner share
 * (wide/rail state) plus the declared render shares and the injected face
 * (hooks compartment bound to useSections). No store is registered — modal
 * open state and active section id are component-local viewing state.
 */
export type SettingsRootComponentProps =
  PropsRuntime<'sidebar.settings'>
  & PropsRenderSlots<
    | 'settings.trigger'
    | 'settings.header'
    | 'settings.action'
    | 'settings.close'
    | 'settings.section'
    | 'settings.onboarding'
  >
  & InjectFace<SettingsRootInjected>
