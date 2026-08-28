/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-agent-preset 全部 UI 文案（英/简中双语）与预设显示文案的解析逻辑。
 * 【技术维度】导出 Record<AgentPresetSettingsKey, string> 字典供 locale 插件注册；
 *             内置预设的显示名/描述按 id 映射到本地化键，用户自定义预设则原样展示文件元数据。
 * 【产品维度】决定设置页、新会话芯片、会话头部、管理分区中所有可见文字；内置预设
 *             （标准/PTC/极简/创造模式）有官方双语文案。
 * 【逻辑维度】1) AgentPresetSettingsKey 枚举全部文案键；2) en/zh 两本字典；
 *             3) presetDisplayText() 依据 trust 是否为 system 选择内置文案或文件元数据。
 * 【关键边界】用户自建预设的 name/description 不做翻译，原样展示；内置预设按稳定 id 匹配。
 * 【新手阅读建议】先看 presetDisplayText() 的判定逻辑，再对照 en/zh 字典了解键的语义。
 * ==========================================================================
 */
/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
// 本包所有文案键的联合类型：新增文案必须先在此登记，en/zh 两本字典才有对应条目。
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetPtcName' | 'presetPtcDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy' | 'switchRefused'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
// 英文字典：每个键对应一段英文界面文案，供 locale 插件在英文环境下选用。
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Applies to sessions you start from now on. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Agent preset for the session you are about to start',
  headerHint: 'The agent preset this session runs, fixed when it started',
  nav: 'Agent presets',
  sectionIntro:
    'A preset is the plugin composition one session\'s agent runs — its tools, prompt, and capabilities. '
    + 'Duplicate an existing one and make it yours, or let the agent draft one for you in Creator mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  presetPtcName: 'PTC mode',
  presetPtcDescription:
    'All Standard mode capabilities, with tools exposed through the PTC mode SDK so the model can combine multi-step operations in one TypeScript program.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'Two-tool coding agent with persistent bash and str_replace_editor.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This deployment has no writable preset directory',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  builtInGroup: 'Built-in',
  customGroup: 'Custom',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A preset that failed to load cannot be duplicated',
  switchRefused: 'Could not switch to {name}: {reason}',
  copyOf: 'Copied from',
  composition: 'Composition (agent.cordis.yml)',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate preset',
  copyIntro:
    'The whole preset is copied on this machine. The identifier becomes its directory name and cannot '
    + 'be changed later; everything else is edited in the preset\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  creatorDraft: 'Draft a custom preset with Creator mode',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Preset files:',
  idRequired: 'Give the preset an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A preset with this identifier already exists.',
  deleteTitle: 'Delete this preset?',
  deleteDescription:
    'The preset directory is deleted. Sessions already running on it keep working; new sessions cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}

/** Simplified Chinese copy. */
// 简体中文字典：与 en 键一一对应，供 locale 插件在中文环境下选用。
export const zh: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent 预设',
  description: '对此后新建的会话生效。运行中的会话保持它开始时的预设。',
  loading: '正在加载预设…',
  error: '无法加载 Agent 预设。',
  userTrust: '自定义',
  seatHint: '即将开始的这个会话所用的 Agent 预设',
  headerHint: '本会话运行的 Agent 预设，开始时即固定',
  nav: 'Agent 预设',
  sectionIntro: '预设即一个会话的 Agent 所运行的插件组装 —— 它的工具、提示词与能力。复制一份既有预设改成自己的，或用「创造模式」让 Agent 帮你创建。',
  builtIn: '内置',
  setDefault: '设为默认',
  view: '查看',
  presetStandardName: '标准模式',
  presetStandardDescription: '功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。',
  presetPtcName: 'PTC 模式',
  presetPtcDescription: '具备标准模式的全部能力，并通过 PTC 模式 SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。',
  presetMinimalName: '极简模式',
  presetMinimalDescription: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
  presetCordisName: '创造模式',
  presetCordisDescription: '用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。',
  duplicate: '复制',
  duplicateUnavailable: '此部署未配置可写的预设目录',
  delete: '删除',
  presetId: '标识符',
  presetIdPlaceholder: 'my-agent',
  displayName: '名称',
  displayNamePlaceholder: '选择器中显示的名字，缺省用标识符',
  inUse: '当前使用',
  builtInGroup: '内置',
  customGroup: '自定义',
  noDescription: '暂无描述。',
  brokenBadge: '加载失败',
  brokenNoCopy: '预设加载失败，不能复制',
  switchRefused: '无法切换到「{name}」：{reason}',
  copyOf: '复制自',
  composition: '组装（agent.cordis.yml）',
  cancel: '取消',
  close: '关闭',
  retry: '重试',
  copyTitle: '复制预设',
  copyIntro: '整个预设会在本机复制一份。标识符将成为目录名，事后无法更改；其余内容之后直接在预设自己的文件里编辑。',
  create: '创建',
  creating: '正在创建…',
  creatorDraft: '用「创造模式」创作自定义预设',
  openLocation: '打开目录',
  showLocation: '查看路径',
  revealedPathLabel: '预设文件：',
  idRequired: '请填写标识符。',
  idInvalid: '只能使用小写字母、数字与连字符，且以字母或数字开头。',
  idTaken: '该标识符已被占用。',
  deleteTitle: '删除该预设？',
  deleteDescription: '预设目录将被删除。已在其上运行的会话不受影响；新会话将无法再选择它。',
  deleteConfirm: '删除',
  deleting: '正在删除…',
}

/** Preset roster fields needed to resolve Web display copy. */
// 显示文案解析所需的清单行字段：只取 id、信任级别与可能存在的名/描述。
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
// 解析后的显示文案：要么来自内置预设的本地化键，要么来自预设文件元数据。
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

/** 内置预设的本地化键对：name 与 description 各指向一个文案键。 */
interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

/** 内置预设 id 到本地化键的映射：standard/code/minimal/cordis 各有名与描述键。 */
const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  ptc: { name: 'presetPtcName', description: 'presetPtcDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
// 解析预设的显示文案：内置预设用官方本地化文案，用户自定义预设原样返回文件元数据。
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
