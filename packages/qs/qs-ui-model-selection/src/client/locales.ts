/** 奇术模型选择文案由本插件拥有，不输出远端错误原文。 */
export const zh = {
  model: '选择模型', effort: '推理强度', providerDefault: '供应商默认', unavailable: '当前会话不可切换模型。',
  loading: '正在读取模型…', choose: '请选择模型', failed: '模型操作失败，请重试。', retry: '重新读取模型',
  partial: '部分供应商目录不可用，其余模型仍可选择。', command: '选择当前会话模型',
} as const
/** 与中文词典逐键对应。 */
export const en = {
  model: 'Select model', effort: 'Reasoning effort', providerDefault: 'Provider default', unavailable: 'Model selection is unavailable for this session.',
  loading: 'Loading models…', choose: 'Choose a model', failed: 'Model operation failed. Retry to continue.', retry: 'Reload models',
  partial: 'Some provider catalogs are unavailable. Other models remain selectable.', command: 'Select the current session model',
} satisfies Record<keyof typeof zh, string>
