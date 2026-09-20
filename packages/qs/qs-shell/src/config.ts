/**
 * qs-shell 的启动配置解析。
 *
 * 同一份解析被两侧使用：Host 半边读 Loader 行配置并把它注入索引页全局，
 * 浏览器半边读该全局。枚举与布尔值在这里校验，非法值直接抛错而不是静默取默认
 * （仓库约定：错配要大声失败）。
 */
import type { QsShellConfig, QsUiId } from './client/contract.ts'

/** 索引页全局名：Host 半边写入，浏览器半边读取。 */
export const QS_UI_CONFIG_GLOBAL = '__QS_UI_CONFIG__'

/** 默认配置：奇术工作台、不开放开发者切换入口。 */
export const DEFAULT_QS_SHELL_CONFIG: QsShellConfig = Object.freeze({
  defaultUi: 'workbench',
  showOfficialUiEntry: false,
})

/** 可选的界面枚举行。 */
const UI_IDS: readonly QsUiId[] = ['workbench', 'official']

/**
 * 校验并补齐一份配置。
 * @param value - 待校验的原始值（Loader 行配置或索引页全局）。
 * @returns 字段齐全的配置。
 * @throws {Error} 当枚举或布尔值非法。
 */
export function resolveQsShellConfig(value: unknown): QsShellConfig {
  if (value === undefined || value === null) return { ...DEFAULT_QS_SHELL_CONFIG }
  if (typeof value !== 'object') throw new Error('qs-shell: config must be an object')
  const raw = value as { defaultUi?: unknown; showOfficialUiEntry?: unknown }
  const defaultUi = raw.defaultUi ?? DEFAULT_QS_SHELL_CONFIG.defaultUi
  if (!UI_IDS.includes(defaultUi as QsUiId)) {
    throw new Error(`qs-shell: config.defaultUi must be one of ${UI_IDS.join(' | ')}`)
  }
  const showOfficialUiEntry = raw.showOfficialUiEntry ?? DEFAULT_QS_SHELL_CONFIG.showOfficialUiEntry
  if (typeof showOfficialUiEntry !== 'boolean') {
    throw new Error('qs-shell: config.showOfficialUiEntry must be a boolean')
  }
  return { defaultUi: defaultUi as QsUiId, showOfficialUiEntry }
}

/**
 * 读取浏览器侧收到的启动配置。
 *
 * 索引页全局缺失（Host 半边未接线或页面被单独承载）时取默认值；字段非法则抛错，
 * 因为非法值说明注入本身有问题，静默降级会把配置错误藏起来。
 * @returns 解析后的配置。
 */
export function readInjectedQsShellConfig(): QsShellConfig {
  const global = globalThis as { [QS_UI_CONFIG_GLOBAL]?: unknown }
  return resolveQsShellConfig(global[QS_UI_CONFIG_GLOBAL])
}
