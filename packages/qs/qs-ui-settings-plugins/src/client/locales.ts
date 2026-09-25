/** 标签导航使用奇术词典，缺少贡献时明确说明。 */
export const zh = {
  searchTitle: 'DeepSeek 搜索', searchURL: '搜索服务地址', searchMaxUses: '单次请求搜索上限', searchCredential: '更新搜索凭据',
  credentialHint: '留空不修改现有凭据；不会读取或回显已保存的密钥。', invalidSearchField: '请输入符合配置要求的值。',
  credentialLoading: '正在读取凭据状态…', credentialReadFailed: '凭据状态读取失败，请重试。', credentialConfigured: '凭据已配置。', credentialMissing: '凭据未配置。',
  credentialReadonly: '当前凭据来源只读，无法在此更新。', credentialReferenceChanged: '凭据引用已变化，请放弃旧草稿后重新输入。',
  searchConflict: '配置版本已更新，请放弃修改后重新编辑。', configurationSaved: '搜索配置已保存。', configurationFailed: '搜索配置未确认保存，草稿已保留。',
  credentialSaved: '凭据写入已确认。', credentialNotAttempted: '凭据尚未写入，草稿已保留。', credentialWriteFailed: '凭据未确认写入，草稿已保留。',
  subagentTitle: '子代理模型', subagentScope: '允许模型选择对新建会话生效，已有会话保持原配置。', subagentEnabled: '允许子代理选择模型',
  subagentOff: '关闭后，子代理使用配置的默认模型或继承父代理模型，已选路由保留。', catalogLoading: '正在读取模型目录…', catalogFailed: '模型目录读取失败，请重试。',
  catalogPartial: '部分供应商目录不可用，已展示可读取的模型。', allowedModels: '允许的模型路由', unavailableRoute: '当前目录不可用，仍可移除授权。',
  selectModel: '启用时至少选择一个模型。', subagentConflict: '配置版本已更新，草稿已保留。请放弃修改后基于当前配置重新编辑。',
  shellTitle: 'Shell 执行配置', timeout: '命令超时（毫秒）', outputLimit: '单流输出上限（字节）', loopTitle: 'AgentLoop 配置', parallel: '并行工具调用上限',
  overridden: '用户覆盖', inherited: '继承配置', currentValue: '当前值', resetField: '恢复继承值', invalidNumber: '请输入符合配置范围的有效数字。',
  conflict: '配置已被其他客户端更新，草稿已保留。请核对当前值后再采用新版本。', saveFailed: '保存未确认成功，草稿已保留。',
  saved: '已保存。', savedRestart: '已保存，重启后生效。', save: '保存', saving: '正在保存…', discard: '放弃修改', adoptRevision: '保留草稿，采用当前版本',
  retry: '重试', readFailed: '暂时无法读取插件配置。', configurable: '插件配置', loading: '正在读取插件配置…', unavailable: '此连接无法读取持久插件配置。', readonly: '当前配置仅供查看。', emptyConfig: '当前部署没有可用的插件配置卡。', title: '插件设置', intro: '配置与清单由各插件独立提供。', tabs: '插件设置页面', empty: '当前没有可用的插件设置页面。' } as const
/** 英文文案与中文逐键对应。 */
export const en = {
  searchTitle: 'DeepSeek search', searchURL: 'Search endpoint', searchMaxUses: 'Searches per request', searchCredential: 'Update search credential',
  credentialHint: 'Leave blank to retain the current credential. Saved keys are never read or displayed.', invalidSearchField: 'Enter a value accepted by this configuration.',
  credentialLoading: 'Reading credential status…', credentialReadFailed: 'Credential status could not be read. Retry to continue.', credentialConfigured: 'Credential configured.', credentialMissing: 'Credential not configured.',
  credentialReadonly: 'The current credential source is read-only.', credentialReferenceChanged: 'The credential reference changed. Discard the old draft and enter it again.',
  searchConflict: 'The configuration revision changed. Discard changes and edit again.', configurationSaved: 'Search configuration saved.', configurationFailed: 'Configuration saving was not confirmed. Your draft is retained.',
  credentialSaved: 'Credential write confirmed.', credentialNotAttempted: 'The credential was not written. Your draft is retained.', credentialWriteFailed: 'Credential writing was not confirmed. Your draft is retained.',
  subagentTitle: 'Subagent models', subagentScope: 'Allowed model selection applies to new sessions. Existing sessions retain their configuration.', subagentEnabled: 'Allow subagents to select models',
  subagentOff: 'When disabled, subagents use configured defaults or inherit the parent model. Selected routes are retained.', catalogLoading: 'Loading model catalog…', catalogFailed: 'The model catalog could not be loaded. Retry to continue.',
  catalogPartial: 'Some provider catalogs are unavailable. Available models are shown.', allowedModels: 'Allowed model routes', unavailableRoute: 'Unavailable in the current catalog; authorization can still be removed.',
  selectModel: 'Select at least one model when enabled.', subagentConflict: 'The configuration revision changed. Your draft is retained. Discard changes and edit the current configuration again.',
  shellTitle: 'Shell execution settings', timeout: 'Command timeout (ms)', outputLimit: 'Output limit per stream (bytes)', loopTitle: 'AgentLoop settings', parallel: 'Parallel tool call limit',
  overridden: 'User override', inherited: 'Inherited', currentValue: 'Current value', resetField: 'Restore inherited value', invalidNumber: 'Enter a valid number within the configured limits.',
  conflict: 'Another client updated this configuration. Your draft is retained. Review the current values before adopting the new revision.', saveFailed: 'Saving was not confirmed. Your draft is retained.',
  saved: 'Saved.', savedRestart: 'Saved. A restart is required.', save: 'Save', saving: 'Saving…', discard: 'Discard changes', adoptRevision: 'Keep draft and adopt current revision',
  retry: 'Retry', readFailed: 'Plugin configuration is temporarily unavailable.', configurable: 'Plugin configuration', loading: 'Reading plugin configuration…', unavailable: 'Persistent plugin configuration is unavailable on this connection.', readonly: 'Configuration is read-only.', emptyConfig: 'No plugin configuration cards are available in this deployment.', title: 'Plugin settings', intro: 'Configuration and inventory are provided by their owning plugins.', tabs: 'Plugin settings pages', empty: 'No plugin settings pages are currently available.' } satisfies Record<keyof typeof zh, string>
